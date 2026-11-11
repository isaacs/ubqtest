// The runner: starts a process for each test file, reads the events
// of each one, and feeds the sinks.
// See docs/04-architecture.md, section 2.
import { spawn } from 'node:child_process'
import { existsSync, globSync, statSync } from 'node:fs'
import { enableCompileCache } from 'node:module'
import { availableParallelism } from 'node:os'
import { join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { startCoverage } from './coverage.ts'
import {
  EVENT_VERSION,
  type FileEvent,
  type RunStart,
  type Sink,
  type UbqEvent,
} from './events.ts'
import { projectRoot, rel } from './project.ts'
import { textSink } from './sink-text.ts'
import { openStore, stateDir, type Store } from './store.ts'

/** The one name pattern for test files. */
const TEST_FILES = '**/*.test.{ts,mts,cts,tsx,js,mjs,cjs,jsx}'

// The source is `.ts`, and the bundle is `.js`.
const PRELOAD = import.meta.resolve(
  import.meta.url.endsWith('.ts') ? './preload.ts' : './preload.js',
)

/** A test file, and the lines that select tests in it. */
export interface Selected {
  /** Path from the project root. */
  file: string
  /** Empty for all tests of the file. */
  lines: number[]
}

/** An error in the command. Exit code 4. */
export class UsageError extends Error {}

/** Test files from command arguments, or all test files of the project. */
export const select = (args: string[]): Selected[] => {
  const root = projectRoot()
  const under = (dir: string): string[] =>
    globSync(TEST_FILES, {
      cwd: dir,
      // The argument is a path from `dir`.
      exclude: path => /(^|[\\/])(node_modules$|\.)/.test(path),
    })
      .sort()
      .map(file => rel(join(dir, file)))
  if (!args.length) return under(root).map(file => ({ file, lines: [] }))
  const byFile = new Map<string, number[]>()
  for (const arg of args) {
    const m = /^(.*?)(?::(\d+))?$/.exec(arg)!
    const path = resolve(m[1]!)
    if (!existsSync(path)) throw new UsageError(`no such file: ${m[1]}`)
    if (statSync(path).isDirectory()) {
      for (const file of under(path)) if (!byFile.has(file)) byFile.set(file, [])
      continue
    }
    const file = rel(path)
    const lines = byFile.get(file) ?? []
    byFile.set(file, lines)
    if (m[2]) lines.push(+m[2])
  }
  return [...byFile].map(([file, lines]) => ({ file, lines }))
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

/** Runs one test file in a new process. Sends its events to `send`. */
const runFile = (
  { file, lines }: Selected,
  send: Sink,
  cacheDir: string,
): Promise<void> =>
  new Promise(done => {
    const child = spawn(
      process.execPath,
      ['--import', PRELOAD, join(projectRoot(), file)],
      {
        cwd: projectRoot(),
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NODE_COMPILE_CACHE: cacheDir,
          UBQ_CHILD: '1',
          UBQ_CAPTURE: '1',
          UBQ_FILE: file,
          UBQ_LINES: lines.join(','),
        },
      },
    )
    let ended = false
    let open: string | undefined
    let buffer = ''
    const pipe = child.stdio[3] as Readable
    pipe.setEncoding('utf8')
    pipe.on('data', (data: string) => {
      buffer += data
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const event = JSON.parse(buffer.slice(0, i)) as FileEvent
        buffer = buffer.slice(i + 1)
        if (event.type === 'file-end') ended = true
        else if (event.type === 'test-start') open = event.id
        else if (event.type === 'test-end') open = undefined
        send(event)
      }
    })
    // Text that did not go through the capture in the child: a
    // crash message from the runtime, or a child of the child.
    let stderr = ''
    child.stderr!.setEncoding('utf8').on('data', (text: string) => {
      stderr += text
      send({ type: 'output', file, stream: 'stderr', text })
    })
    child.stdout!.setEncoding('utf8').on('data', (text: string) => {
      send({ type: 'output', file, stream: 'stdout', text })
    })
    child.on('close', (code, signal) => {
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
  const files = select(args)
  if (!files.length) {
    process.stderr.write(
      'ubq: no test files. A test file has a name that ends in .test.ts (or .test.js, .test.mts, ...), or is an argument: ubq <file>\n',
    )
    return 2
  }
  const cacheDir = join(stateDir(), 'compile-cache')

  // One file runs in this process. It has the runner role for itself.
  if (files.length === 1) {
    const { file, lines } = files[0]!
    enableCompileCache(cacheDir)
    startCoverage(true)
    process.env.UBQ_FILE = file
    process.env.UBQ_CAPTURE = '1'
    process.env.UBQ_LINES = lines.join(',')
    process.argv[1] = join(projectRoot(), file)
    process.env.UBQ_COMMAND = JSON.stringify(['ubq', ...args])
    await import(pathToFileURL(join(projectRoot(), file)).href)
    // The library sets the exit code when the file ends.
    return 0
  }

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
  const sinks: Sink[] = [textSink(write)]
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
  let unselected = 0
  const send = (event: UbqEvent): void => {
    if (event.type === 'test-end') status.set(event.id, event.status)
    else if (event.type === 'late-failure') status.set(event.id, 'fail')
    else if (event.type === 'file-error') errors++
    else if (event.type === 'file-end') unselected += event.unselected
    for (const sink of sinks) sink(event)
  }
  send(start)

  const queue = order(files, store)
  const jobs = Math.min(availableParallelism(), queue.length)
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      for (let next = queue.shift(); next; next = queue.shift())
        await runFile(next, send, cacheDir)
    }),
  )

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
