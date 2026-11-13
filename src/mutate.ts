// `ubq mutate`: a mutation check. Makes one small change to a
// source file at a time, runs the tests that ran the changed line,
// and reports each change that no test failed for.
// The change exists only in the test processes: a load hook makes
// it. The file on disk does not change.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { availableParallelism } from 'node:os'
import { join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { isHelper, UsageError } from './config.ts'
import { changedLines, diffOption } from './git.ts'
import type { Mutant } from './instrument.ts'
import { projectRoot, rel, stateDir } from './project.ts'
import { coversAt, coveredFiles } from './query.ts'
import { runFile } from './runner.ts'
import { fileHash } from './store.ts'

// The source is `.ts`, and the bundle is `.js`.
const INSTRUMENT = import.meta.url.endsWith('.ts') ? './instrument.ts' : './instrument.js'

/** The least time limit of a test in a mutation check, in milliseconds. */
const MIN_LIMIT = 1000

interface Job {
  file: string
  mutant: Mutant
  /** Test file, then the IDs of its tests that ran the line. Empty: all tests of the file. */
  tests: Map<string, string[]>
  /** The longest time of one of the tests in its last run. */
  ms: number
}

/** Runs the check. Prints the report with `out`. Returns the exit code. */
export const mutate = async (
  db: DatabaseSync,
  args: string[],
  out: (text: string) => void,
): Promise<number> => {
  args = [...args]
  const commit = diffOption(args)
  if (!args.length && commit === undefined)
    throw new UsageError(
      'ubq mutate needs a source file, a line of one, or --diff: ubq mutate src/a.ts, ubq mutate src/a.ts:12, or ubq mutate --diff',
    )
  if (process.env.UBQ_COVERAGE === 'v8')
    throw new UsageError('ubq mutate needs source counters. Remove UBQ_COVERAGE=v8.')
  const { mutants } = createRequire(import.meta.url)(INSTRUMENT) as typeof import('./instrument.ts')
  const root = projectRoot()
  const known = coveredFiles(db)
  const last = db.prepare('select status, ms from test where id = ? order by run desc limit 1')
  const hashes = db.prepare('select distinct hash from coverage where file = ?')

  // With `--diff`: only the lines that differ from the commit.
  const diff = commit === undefined ? undefined : changedLines(commit)
  // Not a test helper: a change to one tests the tests (D51).
  if (diff && !args.length) args = [...diff.keys()].filter(f => known.includes(f) && !isHelper(f)).map(f => join(root, f))

  const jobs: Job[] = []
  let uncovered = 0
  for (const arg of args) {
    const m = /^(.*?)(?::(\d+))?$/.exec(arg)!
    const file = rel(resolve(m[1]!))
    const lines = diff?.get(file)
    if (diff && !lines) continue
    if (!known.includes(file))
      throw new UsageError(`no test loaded ${file}. Run the tests first: ubq`)
    // The lines of the stored coverage must be the lines of the file.
    const stored = (hashes.all(file) as { hash: string }[]).map(r => r.hash)
    if (stored.some(hash => hash !== fileHash(file)))
      throw new UsageError(`${file} changed after the last run of its tests. Run them first: ubq --changed`)
    // Deno compiles JSX before a load hook can change the source.
    if (process.versions.deno && /\.[jt]sx$/.test(file))
      throw new UsageError(`ubq mutate cannot change ${file} on Deno. Run it on Node or Bun.`)
    const all = mutants(readFileSync(join(root, file), 'utf8'), file)
    if (!all) throw new UsageError(`ubq cannot read the syntax of ${file}`)
    for (const mutant of all) {
      if (m[2] && mutant.line !== +m[2]) continue
      if (lines && !lines.some(([first, last]) => first <= mutant.line && mutant.line <= last)) continue
      const c = coversAt(db, file, mutant.start)
      const tests = new Map<string, string[]>()
      let ms = 0
      for (const id of c.tests) {
        // A test that fails with no change cannot show a difference.
        const row = last.get(id) as { status: string; ms: number } | undefined
        if (row?.status !== 'pass') continue
        ms = Math.max(ms, row.ms)
        const tfile = id.slice(0, id.indexOf(' > '))
        tests.set(tfile, [...(tests.get(tfile) ?? []), id])
      }
      // Code that runs while a test file loads: all tests of the file.
      for (const tfile of c.loads) tests.set(tfile, [])
      if (tests.size) jobs.push({ file, mutant, tests, ms })
      else uncovered++
    }
  }

  const cacheDir = join(stateDir(), 'compile-cache')
  // Two processes of one test file at the same time can fail for
  // that reason only, so each test file runs one change at a time.
  const busy = new Map<string, Promise<unknown>>()
  const alone = <T>(tfile: string, fn: () => Promise<T>): Promise<T> => {
    const next = (busy.get(tfile) ?? Promise.resolve()).then(fn)
    busy.set(tfile, next.catch(() => {}))
    return next
  }
  /** True if a test fails with the change. */
  const fails = async ({ file, mutant, tests, ms }: Job): Promise<boolean> => {
    const env = {
      UBQ_MUTANT: JSON.stringify([join(root, file), mutant.start, mutant.end, mutant.text]),
      UBQ_LIMIT: String(Math.max(MIN_LIMIT, Math.ceil(ms * 10))),
    }
    for (const [tfile, ids] of tests) {
      let failed = false
      await alone(tfile, () =>
        runFile(
          { file: tfile, lines: [], ids },
          event => {
            if (event.type === 'test-end' ? event.status === 'fail' : event.type === 'late-failure' || event.type === 'file-error')
              failed = true
          },
          cacheDir,
          false,
          env,
        ),
      )
      if (failed) return true
    }
    return false
  }
  const survivors: Job[] = []
  const queue = [...jobs]
  await Promise.all(
    Array.from({ length: Math.min(availableParallelism(), queue.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) if (!(await fails(job))) survivors.push(job)
    }),
  )

  survivors.sort((a, b) => a.file.localeCompare(b.file) || a.mutant.start - b.mutant.start)
  for (const { file, mutant, tests } of survivors) {
    const source = readFileSync(join(root, file), 'utf8').split('\n')[mutant.line - 1]!.trim()
    const count = [...tests.values()].reduce((n, ids) => n + (ids.length || 1), 0)
    out(`SURVIVED ${file}:${mutant.line}:${mutant.column}`)
    out(`  > ${source.length > 100 ? source.slice(0, 100) + '…' : source}`)
    out(`  with ${mutant.from} changed to ${mutant.text || 'nothing'}, no test failed`)
    out(`  tests that run this code: ${count}. For the tests of the line: ubq covers ${file}:${mutant.line}`)
    out('')
  }
  const parts = [`${survivors.length} of ${jobs.length} changes survived`]
  if (uncovered) parts.push(`${uncovered} more are in code that no passing test runs (ubq uncovered)`)
  out(`mutate: ${parts.join(', ')}`)
  return 0
}
