#!/usr/bin/env node
// The `ubq` command: runs tests, and answers questions about stored
// runs. See docs/04-architecture.md, section 5.
import { existsSync, readFileSync } from 'node:fs'
import { doctor } from './doctor.ts'
import { testdirPath } from './fixtures.ts'
import { join, resolve } from 'node:path'
import { projectRoot, rel } from './project.ts'
import {
  coveredFiles,
  covers,
  diffRuns,
  failures,
  fileErrors,
  filesOf,
  flake,
  history,
  incomplete,
  lastResult,
  lastRun,
  outputOf,
  runRow,
  slowest,
  testsUnder,
  uncovered,
} from './query.ts'
import { textSink } from './sink-text.ts'
import { run, UsageError } from './runner.ts'
import { openStore } from './store.ts'

const USAGE = `usage:
  ubq                        run all test files (names that end in .test.ts, .test.js, ...)
  ubq <file or folder>...    run these test files, and the test files in these folders
  ubq <file>:<line>          run the test at that line
  ubq '<test id>'            run one test, or all tests of a group
  ubq --failed               run the tests that failed in their last run
  ubq --changed              run the test files that loaded a file that has changed, and new test files
  ubq --update <file or test id>...  run these tests and write their snapshots (assert.snapshot)
  ubq --types ...            also run the type checker of the project (a run of all test files does this with no option)
  ubq --seed <n> ...         run the test files in the order of an older run (the files run in a random order)
  ubq --repeat <n> ...       run the selected tests n times, and count the failures of each test
  ubq --baseline <commit> ...  run the selected tests, and show only the failures that a clean checkout of the git commit does not have
  ubq failures [run]         the failures of a run (default: the last run)
  ubq show <test id>         the last result of one test
  ubq history <test id>      the result of one test in each stored run
  ubq diff [run] [run]       the tests with a different status in two runs (default: the last run and the run before it)
  ubq slow [run]             the slowest tests of a run (default: the last run)
  ubq uncovered [file]       code that no test ran
  ubq covers <file>:<line>   the tests that ran a line
  ubq sql <query>            a read-only SQL query on .ubq/runs.db, as JSON lines
  ubq guide                  how to write and run tests, for the installed version
  ubq doctor                 checks the setup of the project, and states the fix for each problem
`

const out = (text: string): void => void process.stdout.write(text + '\n')

const QUERIES = ['failures', 'show', 'history', 'diff', 'slow', 'uncovered', 'covers', 'sql']

const main = (args: string[]): number | Promise<number> => {
  const [command, ...rest] = args
  if (command === 'help' || command === '--help') {
    out(USAGE.trimEnd())
    return 0
  }
  if (command === 'guide') {
    // The guide is at the package root. The bundle is there too.
    const path = import.meta.url.endsWith('.ts') ? '../GUIDE.md' : './GUIDE.md'
    out(readFileSync(new URL(path, import.meta.url), 'utf8').trimEnd())
    return 0
  }
  if (command === 'doctor') return doctor(out) ? 1 : 0
  if (!command || !QUERIES.includes(command)) return run(args)
  if (!existsSync(join(projectRoot(), '.ubq', 'runs.db')))
    throw new UsageError('no runs are stored. Run a test file first: node <test file>')
  const { db } = openStore()
  const arg = (name: string): string => {
    if (!rest[0]) throw new UsageError(`ubq ${command} needs ${name}`)
    return rest[0]
  }
  const file = (path: string): string => rel(resolve(path))
  /** The \`testdir\` folder that a failed test left. */
  const kept = (t: { file: string; id: string }): string[] => {
    const dir = testdirPath(t.file, t.id)
    return existsSync(dir) ? [rel(dir)] : []
  }

  switch (command) {
    case 'failures': {
      const run = rest[0] ? +rest[0] : lastRun(db)
      const row = run === undefined ? undefined : runRow(db, run)
      if (!row) throw new UsageError(`run ${rest[0] ?? '(last)'} is not in the store`)
      const sink = textSink(text => void process.stdout.write(text))
      for (const e of fileErrors(db, row.id)) sink({ type: 'file-error', ...e })
      for (const t of failures(db, row.id)) {
        sink({
          type: 'test-start',
          id: t.id,
          timeout: 0,
          ...(t.line !== null && { at: { file: t.file, line: t.line, column: 1 } }),
        })
        sink({
          type: 'test-end',
          id: t.id,
          status: 'fail',
          ms: t.ms,
          asserts: t.asserts,
          failure: t.failure!,
          ...(kept(t).length && { kept: kept(t) }),
        })
      }
      if (row.code === null) out(`run ${row.id} did not end`)
      else
        out(
          `${row.code ? 'fail' : 'pass'}: ${row.fail} failed, ${row.pass} passed (run ${row.id})`,
        )
      return row.code ?? 1
    }

    case 'show': {
      const id = rest.join(' ')
      if (!id) throw new UsageError('ubq show needs a test id')
      const t = lastResult(db, id)
      if (!t) throw new UsageError(`no stored result for test: ${id}`)
      out(`${t.status} ${t.id}`)
      out(`  run ${t.run}, ${t.asserts} assertions, ${t.ms.toFixed(1)} ms`)
      if (t.repeats) out(`  failed ${t.fails} of ${t.repeats} times`)
      if (t.line !== null) out(`  at ${t.file}:${t.line}`)
      if (t.reason) out(`  skip reason: ${t.reason}`)
      if (t.failure) {
        out(`  ${t.failure.message}`)
        if (t.failure.at)
          out(`  at ${t.failure.at.file}:${t.failure.at.line}:${t.failure.at.column}`)
        if (t.failure.diff) out('  ' + t.failure.diff.replaceAll('\n', '\n  '))
      }
      for (const dir of kept(t)) out(`  testdir: ${dir}`)
      const text = outputOf(db, t.run, id).trimEnd()
      if (text) out('  output:\n  | ' + text.replaceAll('\n', '\n  | '))
      const files = filesOf(db, id)
      if (files.length) out(`  ran code in: ${files.join(', ')}`)
      return 0
    }

    case 'history': {
      const id = rest.join(' ')
      if (!id) throw new UsageError('ubq history needs a test id')
      const rows = history(db, id)
      if (!rows.length) {
        const tests = testsUnder(db, id)
        if (!tests.length) throw new UsageError(`no stored result for test: ${id}`)
        const more = tests.length > 10 ? `\n  and ${tests.length - 10} more` : ''
        throw new UsageError(
          `${id} is not a test. It contains these tests:\n  ${tests.slice(0, 10).join('\n  ')}${more}`,
        )
      }
      const width = String(rows.at(-1)!.run).length
      for (const r of rows) {
        const time = new Date(r.time).toISOString().slice(0, 19).replace('T', ' ')
        const rate = r.repeats ? `failed ${r.fails} of ${r.repeats} times` : ''
        const first = r.failure?.message.split('\n')[0]
        const message = rate || first ? `  ${[rate, first].filter(Boolean).join(': ')}` : ''
        out(
          `run ${String(r.run).padStart(width)}  ${time}  ${r.commit ? r.commit.slice(0, 7) + '  ' : ''}${r.status}  ${r.ms.toFixed(1).padStart(7)} ms${message}`,
        )
      }
      const count = (status: string): number => rows.filter(r => r.status === status).length
      const skipped = count('skip') ? `, ${count('skip')} skipped` : ''
      out(`${count('fail')} failed, ${count('pass')} passed${skipped} in ${rows.length} runs (times are UTC)`)
      const f = flake(rows)
      if (f)
        out(
          'run' in f ?
            `flaky: the test failed ${f.fails} of ${f.repeats} times in run ${f.run}`
          : `flaky: the test passed in run ${f.pass} and failed in run ${f.fail}, and the code that it loaded was the same in the two runs`,
        )
      return 0
    }

    case 'diff': {
      if (rest.length > 2) throw new UsageError('ubq diff takes two run numbers at most')
      const last = lastRun(db)
      const given = rest.map(text => {
        if (!/^\d+$/.test(text)) throw new UsageError(`ubq diff needs run numbers, not: ${text}`)
        return +text
      })
      const b = given[1] ?? last
      // The run before \`b\`, if the command does not name a run.
      const a =
        given[0] ??
        (db.prepare('select max(id) id from run where id < ?').get(b ?? 0) as { id: number | null }).id
      for (const run of [a, b])
        if (run == null || !runRow(db, run)) {
          const first = (db.prepare('select min(id) id from run').get() as { id: number | null }).id
          const have = first == null ? 'the store has no runs' : `the store has runs ${first} to ${last}`
          throw new UsageError(
            run == null ? `ubq diff needs two runs, and ${have}` : `run ${run} is not in the store: ${have}`,
          )
        }
      if (a === b) throw new UsageError(`ubq diff needs two different runs, not run ${a} two times`)
      const d = diffRuns(db, a!, b!)
      for (const file of d.newErrors) out(`ERROR ${file} (no error in run ${a})`)
      for (const c of d.changes) {
        out(`${c.to} ${c.id} (${c.from ? `was ${c.from}` : 'did not run'} in run ${a})`)
        if (c.failure) out(`  ${c.failure.message.split('\n')[0]}`)
      }
      for (const file of d.goneErrors) out(`no error ${file} (was ERROR in run ${a})`)
      const failed = d.changes.filter(c => c.to === 'fail').length
      const fixed = d.changes.filter(c => c.from === 'fail' && c.to === 'pass').length
      const other = d.changes.length - failed - fixed
      const parts = [
        `${failed} new failures`,
        `${fixed} fixed`,
        ...(other ? [`${other} other changes`] : []),
        ...(d.newErrors.length ? [`${d.newErrors.length} new file errors`] : []),
        `${d.same} the same`,
        ...(d.onlyA ? [`${d.onlyA} only in run ${a}`] : []),
        ...(d.onlyB ? [`${d.onlyB} only in run ${b}`] : []),
      ]
      out(`run ${a} to run ${b}: ${parts.join(', ')}`)
      for (const run of [a!, b!])
        if (runRow(db, run)!.code === null) out(`note: run ${run} did not end`)
      const bad = failed + d.newErrors.length
      if (bad) out(`details: ubq failures ${b}`)
      return bad ? 1 : 0
    }

    case 'slow': {
      const SHOWN = 10
      const run = rest[0] ? +rest[0] : lastRun(db)
      if (run === undefined || !runRow(db, run))
        throw new UsageError(`run ${rest[0] ?? '(last)'} is not in the store`)
      const tests = slowest(db, run)
      for (const t of tests.slice(0, SHOWN)) out(`${t.ms.toFixed(1).padStart(8)} ms  ${t.id}`)
      const sum = (rows: { ms: number }[]): string => rows.reduce((n, t) => n + t.ms, 0).toFixed(1)
      out(
        `the ${Math.min(SHOWN, tests.length)} slowest of ${tests.length} tests took ${sum(tests.slice(0, SHOWN))} ms of ${sum(tests)} ms (run ${run})`,
      )
      return 0
    }

    case 'uncovered': {
      const files = rest[0] ? [file(rest[0])] : coveredFiles(db)
      if (rest[0] && !coveredFiles(db).includes(files[0]!))
        throw new UsageError(`no test loaded ${files[0]}`)
      let total = 0
      for (const f of files) {
        for (const u of uncovered(db, f)) {
          total++
          const more = u.moreLines ? ` (+${u.moreLines} lines)` : ''
          out(`${u.file}:${u.line}:${u.column}  ${u.text}${more}`)
        }
      }
      out(`${total} uncovered ranges in ${files.length} files`)
      const weak = incomplete(db)
      if (weak.length) {
        const names = weak.map(w => `${w.tfile} (${w.coverage})`).join(', ')
        out(
          `note: coverage is not complete for ${weak.length} test files: ${names}. Code can be missing from this list. For full coverage, run: node --import ubqtest/preload <test file>`,
        )
      }
      return 0
    }

    case 'covers': {
      const m = /^(.*):(\d+)$/.exec(arg('<file>:<line>'))
      if (!m) throw new UsageError('ubq covers needs <file>:<line>')
      const f = file(m[1]!)
      const c = covers(db, f, +m[2]!)
      for (const t of c.tests) out(t)
      for (const t of c.loads) out(`${t} (while the file loads)`)
      out(`${c.tests.length} tests run ${f}:${m[2]}`)
      return 0
    }

    case 'sql': {
      db.exec('pragma query_only = on')
      for (const row of db.prepare(arg('a query')).all()) out(JSON.stringify(row))
      return 0
    }
  }
  throw new UsageError(`unknown command: ${command}`)
}

try {
  // A run of one file in this process sets its own exit code.
  process.exitCode ||= await main(process.argv.slice(2))
} catch (error) {
  const usage = error instanceof UsageError
  process.stderr.write(`ubq: ${usage ? error.message : (error as Error).stack}\n`)
  process.exitCode = 4
}
