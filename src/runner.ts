// The runner: starts a process for each test file, reads the events
// of each one, and feeds the sinks.
// See docs/04-architecture.md, section 2.
import { spawn } from 'node:child_process'
import { existsSync, globSync, statSync } from 'node:fs'
import { enableCompileCache } from 'node:module'
import { availableParallelism } from 'node:os'
import { join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { config, UsageError } from './config.ts'
import { startCoverage } from './coverage.ts'
import {
  EVENT_VERSION,
  type FileEvent,
  type RunStart,
  type Sink,
  type TestStart,
  type UbqEvent,
} from './events.ts'
import { GRACE_MS, pausedStack, STOPPED, stuckMessage } from './probe.ts'
import { projectRoot, rel } from './project.ts'
import { textSink } from './sink-text.ts'
import { compare, runBaseline, type Baseline } from './baseline.ts'
import { repeater } from './repeat.ts'
import { fileHash, openStore, stateDir, type Store } from './store.ts'

/** The one name pattern for test files. */
const TEST_FILES = '**/*.test.{ts,mts,cts,tsx,js,mjs,cjs,jsx}'

// The source is `.ts`, and the bundle is `.js`.
const EXT = import.meta.url.endsWith('.ts') ? '.ts' : '.js'
const BUN_PRELOAD = new URL(`./bun-preload${EXT}`, import.meta.url)

/** The arguments that make a test process collect full coverage. */
const coverageArgs = (): string[] =>
  process.versions.bun ?
    ['--preload', fileURLToPath(BUN_PRELOAD)]
    // With port 0, SIGUSR1 starts the inspector on a free port.
  : ['--inspect-port=0', '--import', import.meta.resolve(`./preload${EXT}`)]

/** A test file, and the lines that select tests in it. */
export interface Selected {
  /** Path from the project root. */
  file: string
  /** Lines that select tests. */
  lines: number[]
  /** Test IDs and group IDs that select tests. */
  ids: string[]
  // With no lines and no IDs, all tests of the file run.
}

export { UsageError }

/** Test files from command arguments, or all test files of the project. */
/**
 * The test files of the project. Not in `node_modules`, not in a
 * folder whose name starts with a dot, and not in a folder that has
 * its own `package.json`: that folder is a different project.
 */
const testFiles = (): string[] => {
  const root = projectRoot()
  const { include, exclude = [] } = config()
  // The argument is a path from the root.
  const skip = (path: string): boolean =>
    /(^|[\\/])(node_modules$|\.)/.test(path) || existsSync(join(root, path, 'package.json'))
  const find = (patterns: string[]): string[] =>
    globSync(patterns, { cwd: root, exclude: skip }).map(f => f.split('\\').join('/'))
  const files = new Set(find(include ?? [TEST_FILES]))
  if (exclude.length) for (const file of find(exclude)) files.delete(file)
  return [...files].filter(f => !include || statSync(join(root, f)).isFile()).sort()
}

/** The test files of the project that are in a folder. */
const under = (dir: string): string[] => {
  const root = projectRoot()
  if (dir === root) return testFiles()
  if (existsSync(join(dir, 'package.json')))
    throw new UsageError(
      `${rel(dir)} is a different project: it has its own package.json. Run ubq in that folder, or name its test files.`,
    )
  const prefix = rel(dir) + '/'
  return testFiles().filter(f => f.startsWith(prefix))
}

export const select = (args: string[]): Selected[] => {
  const root = projectRoot()
  if (!args.length) return under(root).map(file => ({ file, lines: [], ids: [] }))
  const byFile = new Map<string, Selected>()
  const entry = (file: string): Selected => {
    const e = byFile.get(file) ?? { file, lines: [], ids: [] }
    byFile.set(file, e)
    return e
  }
  for (const arg of args) {
    // A test ID starts with the path of its file from the project root.
    const sep = arg.indexOf(' > ')
    if (sep >= 0) {
      const file = arg.slice(0, sep)
      if (!existsSync(join(root, file))) throw new UsageError(`no such file: ${file}`)
      entry(file).ids.push(arg)
      continue
    }
    const m = /^(.*?)(?::(\d+))?$/.exec(arg)!
    const path = resolve(m[1]!)
    if (!existsSync(path)) throw new UsageError(`no such file: ${m[1]}`)
    if (statSync(path).isDirectory()) for (const file of under(path)) entry(file)
    else if (m[2]) entry(rel(path)).lines.push(+m[2])
    else entry(rel(path))
  }
  return [...byFile.values()]
}

/**
 * The tests that failed in the last run of their file, and the files
 * that had an error in their last run.
 */
export const selectFailed = (store: Store): Selected[] => {
  const byFile = new Map<string, Selected>()
  const tests = store.db
    .prepare(
      `with last as (select file, max(run) run from test group by file)
       select id, file from test join last using (file, run) where status = 'fail'`,
    )
    .all() as { id: string; file: string }[]
  for (const { id, file } of tests) {
    const e = byFile.get(file) ?? { file, lines: [], ids: [] }
    byFile.set(file, e)
    e.ids.push(id)
  }
  const errors = store.db
    .prepare(
      `select file from file_error group by file
       having max(run) >= coalesce((select max(run) from test where test.file = file_error.file), 0)`,
    )
    .all() as { file: string }[]
  // A file error can stop tests before they run: run the full file.
  for (const { file } of errors) byFile.set(file, { file, lines: [], ids: [] })
  return [...byFile.values()].filter(s => existsSync(join(projectRoot(), s.file)))
}

const runtime = (): RunStart['runtime'] => {
  const v = process.versions
  return (
    v.bun ? { name: 'bun', version: v.bun }
    : v.deno ? { name: 'deno', version: v.deno }
    : { name: 'node', version: v.node }
  )
}

/**
 * Slow files first, so that they do not start last and decide the
 * length of the run. Files that failed in the last run go before all.
 */
const order = (files: Selected[], store: Store | undefined): Selected[] => {
  if (!store) return files
  const rows = store.db
    .prepare(
      `with last as (select file, max(run) run from test group by file)
       select file, sum(ms) ms, sum(status = 'fail') failed
       from test join last using (file, run) group by file`,
    )
    .all() as { file: string; ms: number; failed: number }[]
  const rank = new Map(rows.map(r => [r.file, (r.failed ? 1e9 : 0) + r.ms]))
  // A file with no history can be slow. Run it early.
  const of = (s: Selected): number => rank.get(s.file) ?? 1e8
  return [...files].sort((a, b) => of(b) - of(a))
}

/** Process groups of the test processes that run now. */
const groups = new Set<number>()
const killGroup = (pid: number): void => {
  groups.delete(pid)
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // The group has no processes.
  }
}
// The children are not in the process group of the runner, so a
// signal from the terminal does not reach them.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
  process.on(signal, () => {
    for (const pid of groups) killGroup(pid)
    process.exit(signal === 'SIGINT' ? 130 : 143)
  })

/**
 * The test files that a change can affect: a file that a test file
 * loaded has different content now, the test file is new, or its
 * loaded files are not known. `changed` lists the files that differ.
 */
export const selectChanged = (store: Store): { files: Selected[]; changed: string[] } => {
  const now = new Map<string, string>()
  const differs = (file: string, hash: string): boolean => {
    let h = now.get(file)
    if (h === undefined) now.set(file, (h = fileHash(file)))
    return h !== hash
  }
  const tfiles = new Set<string>()
  const changed = new Set<string>()
  const known = store.db.prepare('select tfile, coverage, hash from test_file').all() as {
    tfile: string
    coverage: string
    hash: string
  }[]
  for (const { tfile, coverage, hash } of known) {
    if (differs(tfile, hash)) changed.add(tfile)
    else if (coverage !== 'none') continue
    tfiles.add(tfile)
  }
  const rows = store.db.prepare('select distinct tfile, file, hash from coverage').all() as {
    tfile: string
    file: string
    hash: string
  }[]
  for (const { tfile, file, hash } of rows)
    if (differs(file, hash)) {
      changed.add(file)
      tfiles.add(tfile)
    }
  const old = new Set(known.map(k => k.tfile))
  for (const file of under(projectRoot()))
    if (!old.has(file)) {
      changed.add(file)
      tfiles.add(file)
    }
  return {
    files: [...tfiles]
      .filter(file => existsSync(join(projectRoot(), file)))
      .sort()
      .map(file => ({ file, lines: [], ids: [] })),
    changed: [...changed].sort(),
  }
}

/** Runs one test file in a new process. Sends its events to `send`. */
const runFile = (
  { file, lines, ids }: Selected,
  send: Sink,
  cacheDir: string,
): Promise<void> =>
  new Promise(done => {
    const child = spawn(
      process.execPath,
      [...coverageArgs(), join(projectRoot(), file)],
      {
        cwd: projectRoot(),
        // The child leads its own process group, so that one signal
        // stops it and all processes that its tests started.
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NODE_COMPILE_CACHE: cacheDir,
          UBQ_CHILD: '1',
          UBQ_CAPTURE: '1',
          UBQ_FILE: file,
          UBQ_LINES: lines.join(','),
          UBQ_IDS: JSON.stringify(ids),
        },
      },
    )
    let ended = false
    let open: string | undefined
    let watchdog: ReturnType<typeof setTimeout> | undefined
    // The test has a timer for its limit in its own process. If no
    // `test-end` came after that limit, the process is in a loop
    // that does not return.
    const stuck = async (start: TestStart): Promise<void> => {
      ended = true
      child.kill('SIGUSR1')
      let url: string | undefined
      for (let i = 0; i < 20 && !url; i++) {
        await new Promise(r => setTimeout(r, 25))
        url = /ws:\/\/\S+/.exec(stderr)?.[0]
      }
      const stack = url ? await pausedStack(url, child.pid!, projectRoot()) : []
      send({
        type: 'test-end',
        id: start.id,
        status: 'fail',
        ms: start.timeout + GRACE_MS,
        asserts: 0,
        failure: {
          kind: 'timeout',
          message: stuckMessage(start.timeout),
          ...(stack[0] ? { at: stack[0], stack } : start.at && { at: start.at }),
        },
      })
      send({ type: 'file-error', file, failure: { kind: 'error', message: STOPPED } })
      send({ type: 'file-end', file, unselected: 0 })
      killGroup(child.pid!)
    }
    let buffer = ''
    const pipe = child.stdio[3] as Readable
    pipe.setEncoding('utf8')
    pipe.on('data', (data: string) => {
      buffer += data
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const event = JSON.parse(buffer.slice(0, i)) as FileEvent
        buffer = buffer.slice(i + 1)
        if (event.type === 'file-end') ended = true
        else if (event.type === 'test-start') {
          open = event.id
          watchdog = setTimeout(stuck, event.timeout + GRACE_MS, event)
        } else if (event.type === 'test-end') {
          open = undefined
          clearTimeout(watchdog)
        }
        send(event)
      }
    })
    // Text that did not go through the capture in the child: a
    // crash message from the runtime, or a child of the child.
    let stderr = ''
    child.stderr!.setEncoding('utf8').on('data', (text: string) => {
      stderr += text
      // The inspector start message is from the watchdog, not the test.
      if (!ended) send({ type: 'output', file, stream: 'stderr', text })
    })
    child.stdout!.setEncoding('utf8').on('data', (text: string) => {
      send({ type: 'output', file, stream: 'stdout', text })
    })
    groups.add(child.pid!)
    child.on('close', (code, signal) => {
      clearTimeout(watchdog)
      // Processes that the tests started and did not stop.
      killGroup(child.pid!)
      if (!ended)
        send({
          type: 'file-error',
          file,
          failure: {
            kind: 'error',
            message:
              `the test process ended before the file did (${signal ?? `exit code ${code}`})` +
              (open ? `, in test: ${open}` : '') +
              (stderr.trim() ? `\n${stderr.trim().split('\n').slice(-12).join('\n')}` : ''),
          },
        })
      send({ type: 'exit', file, code, signal })
      done()
    })
  })

/** Runs test files. Returns the exit code of the run. */
export const run = async (args: string[]): Promise<number> => {
  // A wrong configuration is an error of the command, before any
  // test process starts.
  config()
  let repeat = 0
  let selection = args
  const at = args.indexOf('--repeat')
  if (at >= 0) {
    const count = args[at + 1] ?? ''
    if (!/^\d+$/.test(count) || +count < 2)
      throw new UsageError(
        "--repeat needs a count of 2 or more, such as: ubq --repeat 20 '<test id>'",
      )
    repeat = +count
    selection = args.toSpliced(at, 2)
  }
  let baselineRef: string | undefined
  const base = selection.indexOf('--baseline')
  if (base >= 0) {
    baselineRef = selection[base + 1]
    if (!baselineRef || baselineRef.startsWith('--'))
      throw new UsageError('--baseline needs a git commit, such as: ubq --baseline HEAD')
    selection = selection.toSpliced(base, 2)
    if (repeat || selection.some(a => a.startsWith('--')))
      throw new UsageError('--baseline takes files and test IDs, and no other option')
  }
  const flags = selection.filter(a => a.startsWith('--'))
  const rest = selection.filter(a => !a.startsWith('--'))
  for (const flag of flags)
    if (flag !== '--failed' && flag !== '--changed')
      throw new UsageError(`unknown option: ${flag}`)
  let files: Selected[]
  if (flags.length) {
    if (rest.length || flags.length > 1)
      throw new UsageError(`${flags[0]} takes no files, no test IDs, and no other option`)
    const store = openStore()
    if (flags[0] === '--failed') {
      files = selectFailed(store)
      store.close()
      if (!files.length) {
        process.stderr.write('ubq: no test failed in its last run\n')
        return 2
      }
    } else {
      const { files: affected, changed } = selectChanged(store)
      store.close()
      files = affected
      if (!files.length) {
        process.stderr.write(
          'ubq: no file that a test loaded has changed since the last run of that test, and no test file is new\n',
        )
        return 2
      }
      const names = changed.slice(0, 10).join(', ')
      const more = changed.length > 10 ? `, and ${changed.length - 10} more` : ''
      process.stdout.write(`changed: ${names}${more}\n`)
    }
  } else files = select(rest)
  if (!files.length) {
    process.stderr.write(
      'ubq: no test files. A test file has a name that ends in .test.ts (or .test.js, .test.mts, ...), or is an argument: ubq <file>\n',
    )
    return 2
  }
  const cacheDir = join(stateDir(), 'compile-cache')

  // One file runs in this process. It has the runner role for itself.
  if (files.length === 1 && !repeat && !baselineRef) {
    const { file, lines, ids } = files[0]!
    enableCompileCache(cacheDir)
    // On Bun, the load plugin must exist before the test file loads.
    if (process.versions.bun) await import(BUN_PRELOAD.href)
    else startCoverage(true)
    process.env.UBQ_FILE = file
    process.env.UBQ_CAPTURE = '1'
    process.env.UBQ_LINES = lines.join(',')
    process.env.UBQ_IDS = JSON.stringify(ids)
    process.argv[1] = join(projectRoot(), file)
    process.env.UBQ_COMMAND = JSON.stringify(['ubq', ...args])
    await import(pathToFileURL(join(projectRoot(), file)).href)
    // The library sets the exit code when the file ends.
    return 0
  }

  // The baseline runs first, so that the text of this run can leave
  // out the failures that the baseline has too.
  let baseline: Baseline | undefined
  if (baselineRef)
    baseline = await runBaseline(baselineRef, rest.length ? files.map(f => f.file) : undefined)

  const t0 = performance.now()
  const start: RunStart = {
    type: 'run-start',
    v: EVENT_VERSION,
    time: Date.now(),
    command: ['ubq', ...args],
    cwd: process.cwd(),
    runtime: runtime(),
    platform: process.platform,
    arch: process.arch,
    ci: !!process.env.CI,
  }
  const write = (text: string): void => void process.stdout.write(text)
  const text = textSink(write)
  const sinks: Sink[] = [
    !baseline ? text : (
      event => {
        // The store has these failures. The text shows the new ones.
        if (event.type === 'test-end' && event.status === 'fail') {
          if (baseline.tests.get(event.id) === 'fail')
            return text({ ...event, status: 'pass', failure: undefined })
        } else if (event.type === 'late-failure') {
          if (baseline.tests.get(event.id) === 'fail') return
        } else if (event.type === 'file-error' && baseline.errors.has(event.file)) return
        text(event)
      }
    ),
  ]
  let store: Store | undefined
  try {
    store = openStore()
    start.run = store.newRun(start)
    sinks.push(store.sink(start.run))
  } catch (error) {
    write(`note: this run is not stored: ${(error as Error).message}\n`)
  }

  const status = new Map<string, 'pass' | 'fail' | 'skip'>()
  let errors = 0
  const errorFiles = new Set<string>()
  let unselected = 0
  const send = (event: UbqEvent): void => {
    if (event.type === 'test-end') status.set(event.id, event.status)
    else if (event.type === 'late-failure') status.set(event.id, 'fail')
    else if (event.type === 'file-error') {
      errors++
      errorFiles.add(event.file)
    }
    else if (event.type === 'file-end') unselected += event.unselected
    for (const sink of sinks) sink(event)
  }
  send(start)

  const ordered = order(files, store)
  const runAll = async (to: Sink): Promise<void> => {
    const queue = [...ordered]
    const jobs = Math.min(availableParallelism(), queue.length)
    await Promise.all(
      Array.from({ length: jobs }, async () => {
        for (let next = queue.shift(); next; next = queue.shift())
          await runFile(next, to, cacheDir)
      }),
    )
  }
  if (repeat) {
    // One repeat after the other, each as a usual run: two processes
    // of one test file at the same time can fail for that reason only.
    const all = repeater(repeat, send)
    for (let i = 0; i < repeat; i++) await runAll(all.collect)
    all.flush()
    write(all.summary() + '\n')
  } else await runAll(send)
  if (baseline) write(compare(baseline, status, errorFiles).join('\n') + '\n')

  const count = (s: string): number => [...status.values()].filter(v => v === s).length
  const fail = count('fail')
  const code =
    fail || errors ? 1
    : count('pass') === 0 ? 2
    : 0
  send({
    type: 'run-end',
    ms: performance.now() - t0,
    pass: count('pass'),
    fail,
    errors,
    skip: count('skip'),
    unselected,
    code,
  })
  store?.close()
  return code
}
