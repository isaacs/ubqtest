#!/usr/bin/env node
// The `ubq` command. In this step it answers questions about stored
// runs. See docs/04-architecture.md, section 5.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { projectRoot, rel } from './project.ts'
import {
  coveredFiles,
  covers,
  failures,
  fileErrors,
  filesOf,
  incomplete,
  lastResult,
  lastRun,
  runRow,
  uncovered,
} from './query.ts'
import { textSink } from './sink-text.ts'
import { run, UsageError } from './runner.ts'
import { openStore } from './store.ts'

const USAGE = `usage:
  ubq                        run all test files (names that end in .test.ts, .test.js, ...)
  ubq <file or folder>...    run these test files, and the test files in these folders
  ubq <file>:<line>          run the test at that line
  ubq failures [run]         the failures of a run (default: the last run)
  ubq show <test id>         the last result of one test
  ubq uncovered [file]       code that no test ran
  ubq covers <file>:<line>   the tests that ran a line
  ubq sql <query>            a read-only SQL query on .ubq/runs.db, as JSON lines
`

const out = (text: string): void => void process.stdout.write(text + '\n')

const QUERIES = ['failures', 'show', 'uncovered', 'covers', 'sql']

const main = (args: string[]): number | Promise<number> => {
  const [command, ...rest] = args
  if (command === 'help' || command === '--help') {
    out(USAGE.trimEnd())
    return 0
  }
  if (!command || !QUERIES.includes(command)) return run(args)
  if (!existsSync(join(projectRoot(), '.ubq', 'runs.db')))
    throw new UsageError('no runs are stored. Run a test file first: node <test file>')
  const { db } = openStore()
  const arg = (name: string): string => {
    if (!rest[0]) throw new UsageError(`ubq ${command} needs ${name}`)
    return rest[0]
  }
  const file = (path: string): string => rel(resolve(path))

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
          ...(t.line !== null && { at: { file: t.file, line: t.line, column: 1 } }),
        })
        sink({
          type: 'test-end',
          id: t.id,
          status: 'fail',
          ms: t.ms,
          asserts: t.asserts,
          failure: t.failure!,
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
      if (t.line !== null) out(`  at ${t.file}:${t.line}`)
      if (t.reason) out(`  skip reason: ${t.reason}`)
      if (t.failure) {
        out(`  ${t.failure.message}`)
        if (t.failure.at)
          out(`  at ${t.failure.at.file}:${t.failure.at.line}:${t.failure.at.column}`)
        if (t.failure.diff) out('  ' + t.failure.diff.replaceAll('\n', '\n  '))
      }
      const files = filesOf(db, id)
      if (files.length) out(`  ran code in: ${files.join(', ')}`)
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
