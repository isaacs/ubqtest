// `ubq mutate`: a mutation check. Makes one small change to a
// source file at a time, runs the tests that ran the changed line,
// and reports each change that no test failed for.
// The change exists only in the test processes: a load hook makes
// it. The file on disk does not change.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { availableParallelism } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { paint } from './color.ts'
import { isBuild, isHelper, UsageError } from './config.ts'
import { changedLines, diffOption } from './git.ts'
import type { Mutant } from './instrument.ts'
import { projectRoot, rel, stateDir } from './project.ts'
import { coversAt, coveredFiles, testReach } from './query.ts'
import { runFile } from './runner.ts'
import { fileHash } from './store.ts'
import { counted } from './counted.ts'

// The source is `.ts`, and the bundle is `.js`.
const INSTRUMENT = import.meta.url.endsWith('.ts') ? './instrument.ts' : './instrument.js'

/** The least time limit of a test in a mutation check, in milliseconds. */
const MIN_LIMIT = 1000

/** The most tests that the block of a survivor names. */
const NAMED = 3

/** The name of a file up to its first dot: `price` for `src/price.ts` and `test/price.test.ts`. */
const stem = (file: string): string => basename(file).replace(/\..*$/, '')

interface Job {
  file: string
  mutant: Mutant
  /** Test file, then the IDs of its tests that ran the line. Empty: all tests of the file. */
  tests: Map<string, string[]>
  /** The longest time of one of the tests in its last run. */
  ms: number
}

/** Runs the check. Prints the report with `out`. Returns the exit code. */
export const mutate = async (db: DatabaseSync, args: string[], out: (text: string) => void): Promise<number> => {
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
  const last = db.prepare('select status, ms, line from test where id = ? order by run desc limit 1')
  const hashes = db.prepare('select distinct hash from coverage where file = ?')

  // With `--diff`: only the lines that differ from the commit.
  const diff = commit === undefined ? undefined : changedLines(commit)
  // Not a test helper: a change to one tests the tests (D51). Not
  // build output (D55).
  if (diff && !args.length)
    args = [...diff.keys()].filter(f => known.includes(f) && !isHelper(f) && !isBuild(f)).map(f => join(root, f))

  const jobs: Job[] = []
  let uncovered = 0
  for (const arg of args) {
    const m = /^(.*?)(?::(\d+))?$/.exec(arg)!
    const file = rel(resolve(m[1]!))
    const lines = diff?.get(file)
    if (diff && !lines) continue
    if (!known.includes(file)) throw new UsageError(`no test loaded ${file}. Run the tests first: ubq`)
    // The lines of the stored coverage must be the lines of the file.
    const stored = (hashes.all(file) as { hash: string }[]).map(r => r.hash)
    if (stored.some(hash => hash !== fileHash(file)))
      throw new UsageError(`${file} changed after the last run of its tests. Run them first: ubq --changed`)
    // Deno compiles JSX before a load hook can change the source.
    // ubq: not measured: on Deno, only the built package counts JSX
    if (process.versions.deno && /\.[jt]sx$/.test(file))
      // ubq: not measured: on Deno, only the built package counts JSX
      throw new UsageError(`ubq mutate cannot change ${file} on Deno. Run it on Node or Bun.`)
    const all = mutants(readFileSync(join(root, file), 'utf8'), file)
    // ubq: not measured: the parser reads each file that a test loaded
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
    busy.set(
      tfile,
      // ubq: not measured: the check of one change does not reject
      next.catch(() => {}),
    )
    return next
  }
  /**
   * The result of the tests with the change: 'fail' if a test
   * failed, 'error' if only a file error or a timeout came, or
   * undefined.
   */
  const check = async ({ file, mutant, tests, ms }: Job): Promise<'fail' | 'error' | undefined> => {
    const env = {
      UBQ_MUTANT: JSON.stringify([join(root, file), mutant.start, mutant.end, mutant.text]),
      UBQ_LIMIT: String(Math.max(MIN_LIMIT, Math.ceil(ms * 10))),
    }
    let result: 'error' | undefined
    for (const [tfile, ids] of tests) {
      let failed: 'fail' | 'error' | undefined
      await alone(tfile, () =>
        runFile(
          { file: tfile, lines: [], ids },
          event => {
            const kind =
              event.type === 'late-failure' ||
              (event.type === 'test-end' && event.status === 'fail' && event.failure?.kind !== 'timeout')
                ? 'fail'
                : event.type === 'file-error' || (event.type === 'test-end' && event.status === 'fail')
                  ? 'error'
                  : undefined
            if (kind) {
              if (failed !== 'fail') failed = kind
              // TEMPORARY: the cause of a rare false kill in CI.
              if (process.env.UBQ_MUTATE_LOG)
                process
                  .getBuiltinModule('node:fs')
                  .appendFileSync(process.env.UBQ_MUTATE_LOG, JSON.stringify({ mutant, ids, event }) + '\n')
            }
          },
          cacheDir,
          false,
          env,
        ),
      )
      if (failed === 'fail') return failed
      result ??= failed
    }
    return result
  }
  /**
   * True if a test fails with the change. A file error or a timeout
   * can come from the machine (a crash, a slow moment), so it counts
   * only if it comes again in a second run.
   */
  const fails = async (job: Job): Promise<boolean> => {
    const result = await check(job)
    return result === 'fail' || (result === 'error' && (await check(job)) !== undefined)
  }
  const survivors: Job[] = []
  const queue = [...jobs]
  await Promise.all(
    Array.from({ length: Math.min(availableParallelism(), queue.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) if (!(await fails(job))) survivors.push(job)
    }),
  )

  survivors.sort((a, b) => a.file.localeCompare(b.file) || a.mutant.start - b.mutant.start)
  // The tests that are the best place for an assertion that the
  // change breaks: those of a test file with the name of the source
  // file, then those that run the least other code.
  const reach = testReach(db, [...new Set(survivors.flatMap(j => [...j.tests.values()].flat()))])
  const closest = ({ file, tests }: Job): string[] => {
    const ids = [...tests.values()].flat()
    const own = (id: string): number => (stem(id.slice(0, id.indexOf(' > '))) === stem(file) ? 0 : 1)
    ids.sort((a, b) => own(a) - own(b) || reach.get(a)! - reach.get(b)! || a.localeCompare(b))
    // Each test has the line of its call.
    return ids
      .slice(0, NAMED)
      .map(id => `${id} (${id.slice(0, id.indexOf(' > '))}:${(last.get(id) as { line: number }).line})`)
  }
  let named = false
  for (const job of survivors) {
    const { file, mutant, tests } = job
    const source = readFileSync(join(root, file), 'utf8').split('\n')[mutant.line - 1]!.trim()
    const count = [...tests.values()].flat().length
    const closer = closest(job)
    const more = count > closer.length ? ` For all of them: ubq covers ${file}:${mutant.line}` : ''
    // Code that runs while a test file loads: no one test runs it.
    const loads = [...tests].filter(([, ids]) => !ids.length).map(([tfile]) => tfile)
    out(`${paint('SURVIVED')} ${file}:${mutant.line}:${mutant.column}`)
    out(`  > ${source.length > 100 ? source.slice(0, 100) + '…' : source}`)
    out(`  with ${mutant.from} changed to ${mutant.text || 'nothing'}, no test failed`)
    if (closer.length) out(`  tests that run this code (${count}), the closest first: ${closer.join(', ')}.${more}`)
    if (loads.length)
      out(
        `  test files that run this code while they load, outside of a test: ${loads.join(', ')}. Call it in a test, and assert on the result.`,
      )
    named ||= closer.length > 0
    out('')
  }
  if (named)
    out('For each change: add an assertion that the change breaks to the first test, or a new test next to it.')
  const parts = [counted`${survivors.length} of ${jobs.length} change|changes survived`]
  if (uncovered) parts.push(`${uncovered} more are in code that no passing test runs (ubq uncovered)`)
  out(`mutate: ${parts.join(', ')}`)
  return 0
}
