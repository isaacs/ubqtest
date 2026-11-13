// The runner: starts a process for each test file, reads the events
// of each one, and feeds the sinks.
// See docs/04-architecture.md, section 2.
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, globSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { availableParallelism } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { config, UsageError } from './config.ts'
import { columnFromCache } from './counter-collector.ts'
import { startCoverage } from './coverage.ts'
import {
  EVENT_VERSION,
  type Failure,
  type FileEvent,
  type RunStart,
  type Sink,
  type TestStart,
  type UbqEvent,
} from './events.ts'
import { type TestProcess, warmProcess } from './pool.ts'
import { debugProcess, GRACE_MS, pausedStack, STOPPED, stuckMessage } from './probe.ts'
import { projectRoot, rel } from './project.ts'
import { textSink } from './sink-text.ts'
import { type Checking, TYPES } from './plain.ts'
import { startBrowserServer } from './browser-server.ts'
import { typeCheck } from './typecheck.ts'
import { compare, runBaseline, type Baseline } from './baseline.ts'
import { headCommit } from './git.ts'
import { hangReruns } from './hang.ts'
import { repeater } from './repeat.ts'
import { shuffle } from './shuffle.ts'
import { fileHash, openStore, pruneSources, stateDir, storedSource, type Store } from './store.ts'

/** The one name pattern for test files. */
const TEST_FILES = '**/*.test.{ts,mts,cts,tsx,js,mjs,cjs,jsx}'

// The source is `.ts`, and the bundle is `.js`.
const EXT = import.meta.url.endsWith('.ts') ? '.ts' : '.js'
const BUN_PRELOAD = new URL(`./bun-preload${EXT}`, import.meta.url)

/**
 * On Node, the runner collects coverage with source counters (D25).
 * `UBQ_COVERAGE=v8` goes back to the V8 collector.
 */
const V8 = process.env.UBQ_COVERAGE === 'v8'
const NODE_PRELOAD = new URL(`./${V8 ? 'preload' : 'counters-preload'}${EXT}`, import.meta.url)

/** The arguments that make a test process collect full coverage. */
export const coverageArgs = (): string[] =>
  process.versions.bun ? ['--preload', fileURLToPath(BUN_PRELOAD)]
    // Deno has no signal that starts the inspector, and the
    // inspector adds no time to the start of a process.
  : process.versions.deno ? ['run', '-A', '--inspect=127.0.0.1:0', '--preload', NODE_PRELOAD.href]
    // With port 0, SIGUSR1 starts the inspector on a free port.
  : ['--inspect-port=0', '--import', NODE_PRELOAD.href]

/** The lines that a runtime prints when its inspector starts. */
const INSPECTOR = /Debugger listening on (ws:\/\/\S+)\r?\n(?:(?:For help, see:|Visit chrome:)[^\n]*\n)?/

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

/** Process groups of the test processes that run now. */
const groups = new Set<number>()
const killGroup = (pid: number): void => {
  const live = groups.delete(pid)
  try {
    // Windows has no process groups. `taskkill` stops a process and
    // the processes that it started, if the process is there.
    if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL')
    else if (live) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
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

/** The part of a file that changed: its start, and its end in the old and in the new content. */
type Change = [from: number, oldTo: number, newTo: number]

const changeOf = (old: string, now: string): Change => {
  const max = Math.min(old.length, now.length)
  let from = 0
  while (from < max && old[from] === now[from]) from++
  let same = 0
  while (same < max - from && old[old.length - 1 - same] === now[now.length - 1 - same]) same++
  return [from, old.length - same, now.length - same]
}

/** The ranges of the old content as ranges of the new content. For ranges that did not run the change. */
const moved = (ranges: number[], [from, oldTo, newTo]: Change): number[] => {
  const at = (offset: number, end: boolean): number =>
    offset <= from ? offset
    : offset >= oldTo ? offset + newTo - oldTo
    : end ? newTo
    : from
  const out: number[] = []
  for (let i = 0; i < ranges.length; i += 3) {
    const start = Math.max(at(ranges[i]!, false), out.at(-2) ?? 0)
    const end = at(ranges[i + 1]!, true)
    if (end > start) out.push(start, end, ranges[i + 2]!)
  }
  return out
}

/**
 * The tests that a change can affect: a test that ran code that is
 * different now, all tests of a test file that is new or changed,
 * or whose coverage is not complete. `changed` lists the files that
 * differ.
 *
 * A test that did not run the changed part of a file stays as it
 * is. Its coverage in the store gets the places of the new content.
 */
export const selectChanged = (store: Store): { files: Selected[]; changed: string[] } => {
  const { db } = store
  const now = new Map<string, string>()
  const hashNow = (file: string): string => {
    let h = now.get(file)
    if (h === undefined) now.set(file, (h = fileHash(file)))
    return h
  }
  /** Test files that run all their tests. */
  const whole = new Set<string>()
  const ids = new Map<string, Set<string>>()
  const changed = new Set<string>()
  const known = db.prepare('select tfile, coverage, hash from test_file').all() as {
    tfile: string
    coverage: string
    hash: string
  }[]
  /** Test files whose coverage has all the code that they ran. */
  const full = new Set<string>()
  for (const { tfile, coverage, hash } of known) {
    if (hashNow(tfile) !== hash) changed.add(tfile)
    else if (coverage !== 'none') {
      if (coverage === 'full') full.add(tfile)
      continue
    }
    whole.add(tfile)
  }
  const pairs = db.prepare('select distinct file, hash from coverage').all() as { file: string; hash: string }[]
  const rowsOf = db.prepare('select tfile, test, ranges from coverage where file = ? and hash = ?')
  const update = db.prepare('update coverage set ranges = ?, hash = ? where tfile = ? and test = ? and file = ?')
  db.exec('begin')
  for (const { file, hash } of pairs) {
    if (hashNow(file) === hash) continue
    changed.add(file)
    const old = storedSource(hash)
    let text: string | undefined
    try {
      text = readFileSync(join(projectRoot(), file), 'utf8')
    } catch {
      // The file went away.
    }
    const change = old === undefined || text === undefined ? undefined : changeOf(old, text)
    for (const row of rowsOf.all(file, hash) as { tfile: string; test: string; ranges: string }[]) {
      // Coverage that is not complete cannot show that a test did
      // not run the change.
      if (!full.has(row.tfile)) whole.add(row.tfile)
      if (whole.has(row.tfile)) continue
      const ranges = JSON.parse(row.ranges) as number[]
      let ran = !change
      // New text with nothing removed has no length in the old
      // content. A range that touches its place counts.
      const edge = change && change[0] === change[1] ? 1 : 0
      for (let i = 0; !ran && i < ranges.length; i += 3)
        ran = ranges[i + 2]! > 0 && ranges[i]! < change![1] + edge && ranges[i + 1]! > change![0] - edge
      if (!ran) update.run(JSON.stringify(moved(ranges, change!)), hashNow(file), row.tfile, row.test, file)
      // Code that ran while the test file loaded can change each test.
      else if (!row.test) whole.add(row.tfile)
      else ids.set(row.tfile, (ids.get(row.tfile) ?? new Set()).add(row.test))
    }
  }
  db.exec('commit')
  pruneSources(db)
  const old = new Set(known.map(k => k.tfile))
  for (const file of under(projectRoot()))
    if (!old.has(file)) {
      changed.add(file)
      whole.add(file)
    }
  return {
    files: [...new Set([...whole, ...ids.keys()])]
      .filter(file => existsSync(join(projectRoot(), file)))
      .sort()
      .map(file => ({ file, lines: [], ids: whole.has(file) ? [] : [...ids.get(file)!].sort() })),
    changed: [...changed].sort(),
  }
}

/**
 * The failure of a test file that did not load, from the text that
 * the runtime wrote: the line of the error, and its place if the
 * place is in the project. Undefined if the text has no such line.
 */
export const loadFailure = (text: string): Failure | undefined => {
  const root = projectRoot()
  // Deno writes colors. A URL of a project file becomes its path.
  const plain = text
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replaceAll(pathToFileURL(root).href + '/', '')
    .replaceAll(root + sep, '')
    // A path of Windows in a message, as the paths of ubq.
    .replace(/[\w.-]+(\\[\w.-]+)+/g, path => path.replaceAll('\\', '/'))
  const error = /^(?:\w*Error\b[^\n]*?|error): (.+)$/m.exec(plain)
  if (!error) return undefined
  const at = /^(?:\s+at )?([^\s:()'"]+\.[cm]?[jt]sx?):(\d+)(?::(\d+))?$/m.exec(plain)
  const inProject = at && !at[1]!.startsWith('/') && !at[1]!.includes('node_modules') && !/^\w+:/.test(at[1]!)
  return {
    kind: 'error',
    message:
      `the test file did not load: ${error[1]}` +
      // Node removes types and makes no other change.
      (/strip-only mode/.test(error[1]!) ?
        '. Node runs only TypeScript syntax that can be erased. Change this syntax, or run the tests on Bun: bun node_modules/.bin/ubq'
      : ''),
    ...(inProject && { at: { file: at[1]!, line: +at[2]!, column: +(at[3] ?? 1) } }),
  }
}

const WORKERS_HOST = fileURLToPath(new URL(`./workers-host${EXT}`, import.meta.url))
let workersFiles: Map<string, string> | undefined
/** The wrangler config of a test file that runs in workerd (D48). Undefined for other files. */
const workersConfig = (file: string): string | undefined => {
  if (!workersFiles) {
    workersFiles = new Map()
    const root = projectRoot()
    for (const { config: path, include } of config().workers ?? [])
      for (const found of globSync(include, { cwd: root })) {
        const name = found.split('\\').join('/')
        if (!workersFiles.has(name)) workersFiles.set(name, join(root, path))
      }
  }
  return workersFiles.get(file)
}

/** The count of event files that this process made. */
let eventFiles = 0

/** Runs one test file in a new process. Sends its events to `send`. */
export const runFile = async (
  { file, lines, ids }: Selected,
  send: Sink,
  cacheDir: string,
  update = false,
  env: Record<string, string> = {},
): Promise<void> => {
  const base = { ...process.env, NODE_COMPILE_CACHE: cacheDir }
  const job = {
    UBQ_CHILD: '1',
    UBQ_CAPTURE: '1',
    UBQ_FILE: file,
    UBQ_LINES: lines.join(','),
    UBQ_IDS: JSON.stringify(ids),
    ...(update && { UBQ_UPDATE: '1' }),
    ...env,
  }
  // Deno cannot write to a descriptor that it gets from its parent.
  // A Deno test process writes its events to a file, and the runner
  // reads the file while it grows.
  const eventsFile = process.versions.deno ? join(stateDir(), 'events', `${process.pid}-${++eventFiles}`) : undefined
  if (eventsFile) {
    mkdirSync(join(stateDir(), 'events'), { recursive: true })
    writeFileSync(eventsFile, '')
    Object.assign(job, { UBQ_EVENTS: eventsFile })
  }
  const path = join(projectRoot(), file)
  // The background server of the project has processes that are
  // started. With no server, the process starts here.
  const workers = workersConfig(file)
  if (workers) Object.assign(job, { UBQ_WORKERS_CONFIG: workers })
  const child: TestProcess =
    workers ?
      // wrangler needs Node. The host process starts workerd.
      spawn(process.versions.bun || process.versions.deno ? 'node' : process.execPath, [WORKERS_HOST, path], {
        cwd: projectRoot(),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        env: { ...base, ...job },
      })
    : (await warmProcess({ file: path, base, job })) ??
    spawn(process.execPath, [...coverageArgs(), path], {
      cwd: projectRoot(),
      // The child leads its own process group, so that one signal
      // stops it and all processes that its tests started.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      env: { ...base, ...job },
    })
  return new Promise(done => {
    let ended = false
    /** True after the first event of the file. */
    let started = false
    /** True after the runner gave the file up. Its later events are not part of the run. */
    let stopped = false
    let open: string | undefined
    let watchdog: ReturnType<typeof setTimeout> | undefined
    // The test has a timer for its limit in its own process. If no
    // `test-end` came after that limit, the process is in a loop
    // that does not return.
    const stuck = async (start: TestStart): Promise<void> => {
      ended = stopped = true
      // SIGUSR1 starts the inspector of Node. It ends a Deno process,
      // which has its inspector from the start.
      // Windows has no such signal. Node has a function there with
      // the same effect.
      // The process of a Workers test file is the host of workerd.
      // Its stack does not have the code of the test.
      if (!workers) {
        if (process.platform === 'win32') debugProcess(child.pid!)
        else if (!process.versions.deno) child.kill('SIGUSR1')
        for (let i = 0; i < 20 && !url; i++) await new Promise(r => setTimeout(r, 25))
      }
      const frames = url ? await pausedStack(url, child.pid!, projectRoot()) : []
      // With source counters, the columns are those of the changed source.
      const stack =
        V8 ? frames : frames.map(f => ({ ...f, column: columnFromCache(f.file, f.line, f.column) }))
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
    const feed = (data: string): void => {
      buffer += data
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const event = JSON.parse(buffer.slice(0, i)) as FileEvent
        buffer = buffer.slice(i + 1)
        if (stopped) continue
        started = true
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
    }
    /** Reads the new part of the events file of a Deno process. */
    let poll = (): void => {}
    let polling: ReturnType<typeof setInterval> | undefined
    if (eventsFile) {
      const fd = openSync(eventsFile, 'r')
      const decoder = new StringDecoder('utf8')
      const chunk = Buffer.alloc(1 << 16)
      let at = 0
      poll = () => {
        for (let n = readSync(fd, chunk, 0, chunk.length, at); n > 0; n = readSync(fd, chunk, 0, chunk.length, at)) {
          at += n
          feed(decoder.write(chunk.subarray(0, n)))
        }
      }
      polling = setInterval(poll, 10)
      child.on('close', () => {
        clearInterval(polling)
        poll()
        closeSync(fd)
        rmSync(eventsFile, { force: true })
      })
    } else (child.stdio[3] as Readable).setEncoding('utf8').on('data', feed)
    // Text that did not go through the capture in the child: a
    // crash message from the runtime, or a child of the child.
    let stderr = ''
    /** The address of the inspector of the child. */
    let url: string | undefined
    child.stderr!.setEncoding('utf8').on('data', (text: string) => {
      // The inspector start message is not output of the test.
      const m = INSPECTOR.exec(text)
      if (m) {
        url = m[1]
        text = text.replace(INSPECTOR, '')
      }
      stderr += text
      if (!ended && text) send({ type: 'output', file, stream: 'stderr', text })
    })
    child.stdout!.setEncoding('utf8').on('data', (text: string) => {
      send({ type: 'output', file, stream: 'stdout', text })
    })
    groups.add(child.pid!)
    child.on('close', (code, signal) => {
      clearTimeout(watchdog)
      // Processes that the tests started and did not stop. On
      // Windows, they stay: the process that started them is gone.
      if (process.platform === 'win32') groups.delete(child.pid!)
      killGroup(child.pid!)
      const load = started ? undefined : loadFailure(stderr)
      if (load) send({ type: 'file-error', file, failure: load })
      else if (!ended)
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
}

/** The folders of the `workspaces` of the root `package.json` that are projects. */
const workspaces = (): string[] => {
  const root = projectRoot()
  let field: unknown
  try {
    field = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { workspaces?: unknown }).workspaces
  } catch {
    return []
  }
  const patterns = Array.isArray(field) ? field : (field as { packages?: unknown } | undefined)?.packages
  if (!Array.isArray(patterns)) return []
  return globSync(patterns as string[], { cwd: root })
    .filter(dir => !dir.includes('node_modules') && existsSync(join(root, dir, 'package.json')))
    .map(dir => dir.split(sep).join('/'))
    .sort()
}

/**
 * Runs the command in each workspace, one after the other. Each
 * workspace has its own store, and the paths of its report are
 * from its own folder.
 */
const runWorkspaces = (folders: string[], args: string[]): number => {
  const failed: string[] = []
  let ran = 0
  for (const folder of folders) {
    process.stdout.write(`workspace ${folder}:\n`)
    const r = spawnSync(
      process.execPath,
      [...(process.versions.deno ? ['run', '-A'] : []), process.argv[1]!, ...args],
      { cwd: join(projectRoot(), folder), stdio: 'inherit' },
    )
    // Exit code 2: the workspace has no tests.
    if (r.status !== 2) ran++
    if (r.status !== 0 && r.status !== 2) failed.push(folder)
  }
  process.stdout.write(
    failed.length ?
      `workspaces: ${failed.length} of ${ran} failed: ${failed.join(', ')}. Run ubq in the folder of a workspace for its tests.\n`
    : `workspaces: ${ran} passed\n`,
  )
  return (
    failed.length ? 1
    : ran ? 0
    : 2
  )
}

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
  let seed: number | undefined
  const seedAt = selection.indexOf('--seed')
  if (seedAt >= 0) {
    const text = selection[seedAt + 1] ?? ''
    if (!/^\d+$/.test(text))
      throw new UsageError('--seed needs the number from a run, such as: ubq --seed 1234')
    seed = +text
    selection = selection.toSpliced(seedAt, 2)
  }
  const update = selection.includes('--update')
  if (update) {
    selection = selection.filter(a => a !== '--update')
    // An update of all snapshots hides changes that nobody looked at.
    if (repeat || !selection.length || selection.some(a => a.startsWith('--')))
      throw new UsageError(
        "--update needs the tests whose snapshots it writes, and no other option: ubq --update <file>, or ubq --update '<test id>'",
      )
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
  // The root of a monorepo with no tests of its own: each workspace
  // is a project, and gets its own run of the command.
  if (!rest.length) {
    const folders = workspaces()
    if (folders.length && !select([]).length) return runWorkspaces(folders, args)
  }
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
          changed.length ?
            `ubq: no test ran the code that changed in ${changed.join(', ')}\n`
          : 'ubq: no file that a test loaded has changed since the last run of that test, and no test file is new\n',
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

  // The server of the pages, for test files that use the browser.
  const server = await startBrowserServer(files.map(f => f.file))
  if (server) {
    groups.add(server)
    process.on('exit', () => killGroup(server))
  }

  // Each run of a TypeScript project also checks the types (D38).
  const lone = files.length === 1 && !repeat && !baselineRef
  const checking = typeCheck(lone)

  // One file runs in this process. It has the runner role for itself.
  if (lone) {
    // The runner role of the library waits for the type check.
    if (checking) (globalThis as { [TYPES]?: Checking })[TYPES] = checking
    const { file, lines, ids } = files[0]!
    // Deno has no compile cache of this form.
    nodeModule.enableCompileCache?.(cacheDir)
    // On Bun, the load plugin must exist before the test file loads.
    if (process.versions.bun) await import(BUN_PRELOAD.href)
    else if (V8) startCoverage(true)
    else await import(NODE_PRELOAD.href)
    process.env.UBQ_FILE = file
    process.env.UBQ_CAPTURE = '1'
    process.env.UBQ_LINES = lines.join(',')
    process.env.UBQ_IDS = JSON.stringify(ids)
    if (update) process.env.UBQ_UPDATE = '1'
    process.argv[1] = join(projectRoot(), file)
    process.env.UBQ_COMMAND = JSON.stringify(['ubq', ...args])
    try {
      await import(pathToFileURL(join(projectRoot(), file)).href)
      // The library sets the exit code when the file ends.
      return 0
    } catch (error) {
      // The library reports an error of the file, if the library
      // loaded. If not, the file runs again in a child process, which
      // gives the report of a file that did not load.
      if (process.emit('uncaughtException', error as Error)) return 0
      checking?.wait()
      delete (globalThis as { [TYPES]?: Checking })[TYPES]
    }
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
    seed: (seed ??= Math.floor(Math.random() * 1e6)),
  }
  const commit = headCommit()
  if (commit) start.commit = commit
  // The reader of stdout can go away (`ubq | head`). The run goes
  // on, so that the store has its results.
  process.stdout.on('error', () => {})
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
  /** Tests that timed out with something open. */
  const hung: string[] = []
  const send = (event: UbqEvent): void => {
    if (event.type === 'test-end') {
      status.set(event.id, event.status)
      if (event.failure?.kind === 'timeout' && event.failure.pending) hung.push(event.id)
    }
    else if (event.type === 'late-failure') status.set(event.id, 'fail')
    else if (event.type === 'file-error') {
      errors++
      errorFiles.add(event.file)
    }
    else if (event.type === 'file-end') unselected += event.unselected
    for (const sink of sinks) sink(event)
  }
  send(start)

  const ordered = shuffle(files, seed)
  const runAll = async (to: Sink): Promise<void> => {
    const queue = [...ordered]
    const jobs = Math.min(availableParallelism(), queue.length)
    await Promise.all(
      Array.from({ length: jobs }, async () => {
        for (let next = queue.shift(); next; next = queue.shift())
          await runFile(next, to, cacheDir, update)
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
  } else {
    await runAll(send)
    for (const hang of hangReruns(hung)) send(hang)
  }
  const typeErrors = (await checking?.errors) ?? []
  for (const error of typeErrors) send(error)
  if (baseline) write(compare(baseline, status, errorFiles).join('\n') + '\n')
  // The order of the files can be the cause of a failure.
  if (ordered.length > 1 && ([...status.values()].includes('fail') || errorFiles.size))
    write(`file order: seed ${seed}. For the same order: ubq --seed ${seed} ...\n`)

  const count = (s: string): number => [...status.values()].filter(v => v === s).length
  const fail = count('fail')
  const code =
    fail || errors || typeErrors.length ? 1
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
    ...(checking && { types: typeErrors.length }),
    code,
  })
  store?.close()
  return code
}
