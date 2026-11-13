// The background server of a project: `ubq server`. It keeps test
// processes that are started and wait for a test file, and it makes
// the counters of a source file when the file changes. A runner
// that finds the server gets its test processes from it.
// See docs/11-server.md.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { chmodSync, openSync, rmSync, watch, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { UsageError } from './config.ts'
import { prepareCounters } from './counter-collector.ts'
import { dial, frame, type Request, socketAddress, socketPath, stamp } from './pool.ts'
import { projectRoot, stateDir } from './project.ts'
import { coverageArgs } from './runner.ts'

/** Test processes that wait. More do not help an edit loop, and each one has memory. */
const POOL = 8
/** The server stops after this time with no request and no change of a file. */
const IDLE_MS = 30 * 60_000

// The source is `.ts`, and the bundle is `.js`.
// ubq: not measured: the package test does not start the server
const WARM = fileURLToPath(new URL(`./warm${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url))

/** Variables that a shell changes, and that no runtime reads when it starts. */
const INERT = new Set(['_', 'SHLVL', 'PWD', 'OLDPWD'])
type Env = Record<string, string | undefined>
const sameEnv = (a: Env, b: Env): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) if (!INERT.has(key) && a[key] !== b[key]) return false
  return true
}

interface Status {
  pid: number
  warm: number
  used: number
  prepared: number
}

/** One request to the server, and its answer as text. Undefined if no server answers. */
const ask = async (type: 'status' | 'stop'): Promise<string | undefined> => {
  const socket = await dial()
  if (!socket) return undefined
  return new Promise(done => {
    let text = ''
    socket.setEncoding('utf8').on('data', (data: string) => (text += data))
    // ubq: not measured: a local socket gives no error after it connects
    socket.on('error', () => done(undefined))
    socket.on('close', () => done(text))
    socket.write(JSON.stringify({ type }) + '\n')
  })
}

const describe = (text: string): string => {
  const s = JSON.parse(text) as Status
  return `server: pid ${s.pid}, ${s.warm} test processes wait, ${s.used} used, ${s.prepared} changed files prepared`
}

/** `ubq server` and `ubq server stop`. Returns the exit code. */
export const serverCommand = async (args: string[], out: (text: string) => void): Promise<number> => {
  if (args[0] === '--foreground') return serve()
  if (args[0] === 'stop') {
    out((await ask('stop')) === undefined ? 'server: not running' : 'server: stopped')
    return 0
  }
  if (args.length) throw new UsageError('usage: ubq server, or ubq server stop')
  const running = await ask('status')
  if (running) {
    out(describe(running))
    return 0
  }
  if (!socketAddress())
    throw new UsageError(`the path of the project is too long for a socket: ${socketPath()}`)
  // The server died and left its socket.
  rmSync(socketPath(), { force: true })
  const log = openSync(join(stateDir(), 'server.log'), 'a')
  spawn(
    process.execPath,
    // ubq: not measured: the tests run the command line on Node
    [...(process.versions.deno ? ['run', '-A'] : []), process.argv[1]!, 'server', '--foreground'],
    { cwd: projectRoot(), detached: true, windowsHide: true, stdio: ['ignore', log, log] },
  ).unref()
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 20))
    const started = await ask('status')
    if (started) {
      out(describe(started))
      out('It stops after 30 minutes with no use, or with: ubq server stop')
      return 0
    }
  }
  // ubq: not measured: the tests have no server that fails to start
  throw new UsageError(`the server did not start. Its errors are in ${join(stateDir(), 'server.log')}`)
}

/** The server process. Returns when the server stops. */
const serve = (): Promise<number> =>
  new Promise(done => {
    const root = projectRoot()
    process.chdir(root)
    const own = stamp()
    let base: Env = { ...process.env, NODE_COMPILE_CACHE: join(stateDir(), 'compile-cache') }
    let pool: ChildProcess[] = []
    let used = 0
    let prepared = 0

    const kill = (...children: ChildProcess[]): void => {
      // Windows has no process groups. `taskkill` stops each process
      // and the processes that it started. One call for all: each
      // call takes a part of a second.
      if (process.platform === 'win32') {
        const pids = children.filter(c => c.exitCode === null).flatMap(c => ['/pid', String(c.pid)])
        if (pids.length) spawnSync('taskkill', [...pids, '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        return
      }
      for (const child of children) {
        try {
          process.kill(-child.pid!, 'SIGKILL')
        } catch {
          // The process ended before.
        }
      }
    }
    const fill = (): void => {
      while (pool.length < POOL) {
        const child = spawn(process.execPath, [...coverageArgs(), WARM], {
          cwd: root,
          // As a test process of the runner: the leader of its group.
          detached: true,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
          env: base,
        })
        // ubq: not measured: a warm process reads its stdin before it ends
        child.stdin!.on('error', () => {})
        child.on('close', () => (pool = pool.filter(c => c !== child)))
        pool.push(child)
      }
    }

    let idle: ReturnType<typeof setTimeout>
    const stop = (): void => {
      clearTimeout(idle)
      watcher?.close()
      kill(...pool)
      rmSync(socketPath(), { force: true })
      server.close()
      done(0)
    }
    const active = (): void => {
      clearTimeout(idle)
      idle = setTimeout(stop, IDLE_MS)
    }

    const run = (socket: Socket, request: Request & { type: 'run' }): void => {
      const none = (): void => void socket.end(frame('n', ''))
      // A runner with a different runtime or a different ubq: the
      // processes here loaded code that is not the code of the runner.
      if (request.stamp !== own) {
        none()
        return stop()
      }
      // A runtime reads some variables only when it starts. A process
      // that started with a different environment is not the process
      // that the runner would start. The next ones are.
      if (!sameEnv(request.base, base)) {
        base = request.base
        kill(...pool)
        pool = []
        fill()
        return none()
      }
      const child = pool.shift()
      fill()
      // ubq: not measured: no warm process of the tests ends early
      if (!child) return none()
      used++
      socket.write(frame('i', String(child.pid)))
      child.stdout!.on('data', (data: Buffer) => socket.write(frame('o', data)))
      child.stderr!.on('data', (data: Buffer) => socket.write(frame('e', data)))
      ;(child.stdio[3] as NodeJS.ReadableStream).on('data', (data: Buffer) => socket.write(frame('p', data)))
      child.on('close', (code, signal) => socket.end(frame('x', JSON.stringify({ code, signal }))))
      // The runner went away: its test process must not stay.
      socket.on('close', () => kill(child))
      child.stdin!.end(JSON.stringify({ file: request.file, env: { ...request.base, ...request.job } }))
    }

    const server = createServer(socket => {
      active()
      // ubq: not measured: a local socket gives no error in the tests
      socket.on('error', () => {})
      let text = ''
      const onData = (data: Buffer): void => {
        text += data
        const end = text.indexOf('\n')
        // ubq: not measured: a request is one short line, in one chunk
        if (end < 0) return
        socket.off('data', onData)
        const request = JSON.parse(text.slice(0, end)) as Request
        if (request.type === 'run') run(socket, request)
        else {
          const status: Status = { pid: process.pid, warm: pool.length, used, prepared }
          socket.end(JSON.stringify(status))
          if (request.type === 'stop') stop()
        }
      }
      socket.on('data', onData)
    })
    server.listen(socketAddress(), () => {
      // Only this user can ask for a test process. On Windows, the
      // file is not the socket: it tells a runner that a server started.
      if (process.platform === 'win32') writeFileSync(socketPath(), '')
      else chmodSync(socketPath(), 0o600)
      fill()
      active()
    })
    server.on('error', error => {
      process.stderr.write(`ubq server: ${error.message}\n`)
      // The watcher keeps the process alive.
      watcher?.close()
      done(4)
    })

    // A file that changed has no counters in the cache. The first
    // test process that loads it would have to load the parser.
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    let watcher: ReturnType<typeof watch> | undefined
    try {
      watcher = watch(root, { recursive: true }, (_event, name) => {
        if (!name || !/\.([cm]?[jt]s|[jt]sx)$/.test(name) || /(^|[\\/])(node_modules|\.[^\\/]+)[\\/]/.test(name)) return
        active()
        clearTimeout(timers.get(name))
        timers.set(
          name,
          setTimeout(() => {
            timers.delete(name)
            if (prepareCounters(join(root, name))) prepared++
          }, 20),
        )
      })
      // ubq: not measured: the tests make no error of the watcher
      watcher.on('error', () => {})
      // ubq: not measured: each runtime of the tests can watch a tree
    } catch {
      // This runtime cannot watch a folder with its subfolders.
    }

    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop)
  })
