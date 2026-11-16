// `ubq check`: is the last result of the tests the result of the
// code as it is now? For an agent before it says that its work is
// done, and for the stop hook of an agent (D67). On a pass, its
// output is the evidence for the last message of the agent (D74).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isBuild, isHelper } from './config.ts'
import { paint } from './color.ts'
import { changedLines, diffOption, headCommit } from './git.ts'
import { projectRoot } from './project.ts'
import { hasCoverage, lastRun, stale, typeErrors, uncovered, unloadedChanges } from './query.ts'
import { reviewItems } from './review.ts'
import { LAST_RESULTS, selectChanged, selectFailed, UsageError } from './runner.ts'
import { runsInProgress } from './status.ts'
import { fileHash, openStore, stateDir } from './store.ts'

/** The most items of one kind that the report names. */
const SHOWN = 10

const list = (items: string[]): string =>
  items.slice(0, SHOWN).join(', ') + (items.length > SHOWN ? `, and ${items.length - SHOWN} more` : '')

/** The problems, one paragraph each. Empty if there are none. */
const problems = (commit: string | undefined): { report: string[]; summary: string[]; passed?: number } => {
  const report: string[] = []
  const summary: string[] = []
  const running = runsInProgress()
  if (running.length) {
    summary.push(
      `run ${running.join(', ')} is in progress. Wait for its end, then run: ubq check. To see it: ubq status`,
    )
    return { report, summary }
  }
  if (!existsSync(join(projectRoot(), '.ubq', 'runs.db'))) {
    summary.push('no run. Run: ubq')
    return { report, summary }
  }
  const store = openStore()
  try {
    const { db } = store
    const run = lastRun(db)
    if (run === undefined) {
      summary.push('no run. Run: ubq')
      return { report, summary }
    }

    // The last result of each test.
    const failed = selectFailed(store)
    const tests = failed.flatMap(f => f.ids)
    const errors = failed.filter(f => !f.ids.length).map(f => f.file)
    if (tests.length) report.push(`${tests.length} failed tests: ${list(tests)}. To see them: ubq failures`)
    if (errors.length) report.push(`${errors.length} file errors: ${list(errors)}`)
    if (failed.length) {
      report.push('After a fix, run: ubq --failed')
      if (tests.length) summary.push(`${tests.length} failed tests`)
      if (errors.length) summary.push(`${errors.length} file errors`)
    }

    // Code that changed after its tests ran. A test file with no
    // coverage (the runtime has none) runs again only if it changed.
    const none = new Map(
      (
        db.prepare("select tfile, hash from test_file where coverage = 'none'").all() as {
          tfile: string
          hash: string
        }[]
      ).map(r => [r.tfile, r.hash]),
    )
    const { files } = selectChanged(store)
    const again = files.map(f => f.file).filter(f => !none.has(f) || fileHash(f) !== none.get(f))
    if (again.length) {
      report.push(`${again.length} test files to run again: ${list(again)}. Run: ubq --changed`)
      summary.push(`${again.length} test files to run again`)
    }

    const types = typeErrors(db, run).length
    if (types) {
      report.push(`${types} type errors. To see them: ubq failures ${run}`)
      summary.push(`${types} type errors`)
    }

    // The changed lines that no test runs. Only on current
    // coverage: with a test to run again, the places can be wrong.
    if (commit && !summary.length) {
      const diff = changedLines(commit)
      const lines: string[] = []
      for (const [file, groups] of diff) {
        if (isHelper(file) || isBuild(file) || !hasCoverage(db, file) || stale(db, file)) continue
        for (const u of uncovered(db, file))
          if (!u.notMeasured && groups.some(([first, last]) => first <= u.line + u.moreLines && last >= u.line))
            lines.push(`  ${u.file}:${u.line}:${u.column}  ${u.text}${u.moreLines ? ` (+${u.moreLines} lines)` : ''}`)
      }
      const unloaded = unloadedChanges(db, diff)
      if (lines.length) {
        report.push(
          `${lines.length} uncovered ranges in changed lines:\n` +
            lines.slice(0, SHOWN).join('\n') +
            (lines.length > SHOWN ? `\n  and ${lines.length - SHOWN} more` : '') +
            '\nWrite a test that runs them. All of them: ubq uncovered --diff' +
            (commit === 'HEAD' ? '' : `=${commit}`) +
            '. For code that no test can reach, a comment: // ubq: not measured: <reason>',
        )
        summary.push(`${lines.length} uncovered ranges in changed lines`)
      }
      if (unloaded.length) {
        report.push(`${unloaded.length} changed files that no test loads: ${list(unloaded)}`)
        summary.push(`${unloaded.length} changed files that no test loads`)
      }
    }
    if (summary.length) return { report, summary }
    const counts = db
      .prepare(`select file, count(*) n from (${LAST_RESULTS}) where status = 'pass' group by file`)
      .all() as { file: string; n: number }[]
    const passed = counts.filter(c => existsSync(join(projectRoot(), c.file))).reduce((sum, c) => sum + c.n, 0)
    return { report, summary, passed }
  } finally {
    store.close()
  }
}

/**
 * The problems that `ubq check` finds, from the lines that differ
 * from `commit` (undefined with no git), and its last line.
 */
const checkResult = (commit: string | undefined): { report: string[]; summary: string[]; result: string } => {
  const { report, summary, passed } = problems(commit)
  const result = summary.length
    ? `fail: ${summary.join(', ')}`
    : `pass: ${passed} tests pass on the code as it is now${commit ? ', and each change ran in a test' : ''}.`
  return { report, summary, result }
}

/**
 * Prints the problems, and returns 1 if there are some. On a pass, it
 * prints the changes to the tests that a person must look at. With
 * `--hook`, it is the stop hook of a coding agent: it writes a JSON
 * decision to stdout, and returns 0.
 */
export const check = (args: string[], out: (line: string) => void): number => {
  const rest = [...args]
  const hook = rest.includes('--hook')
  const diff = diffOption(rest)
  const other = rest.filter(a => a !== '--hook')
  if (other.length) throw new UsageError(`ubq check takes --diff=<commit> and --hook, not: ${other.join(' ')}`)
  // With no git, there is no diff to check.
  const commit = diff ?? (headCommit() ? 'HEAD' : undefined)
  const { report, summary, result } = checkResult(commit)
  if (!hook) {
    for (const part of report) out(part)
    const items = !summary.length && commit ? reviewItems(diff).items : []
    if (items.length) out(['Changes to the tests to look at:', ...items.flat()].join('\n'))
    const status = result.slice(0, result.indexOf(':'))
    out(paint(status) + result.slice(status.length))
    return summary.length ? 1 : 0
  }
  return stopHook(report, summary.length > 0, result, out)
}

/**
 * A stop hook blocks the end of the turn of the agent while there is
 * a problem, one time for each report. When the agent stops again
 * with the same report, the hook lets it stop: the agent saw the
 * report, and can tell the user. A change to the code or to the
 * results makes a different report.
 */
const stopHook = (report: string[], bad: boolean, result: string, out: (line: string) => void): number => {
  const file = join(stateDir(), 'check-hook')
  const text = [...report, result].join('\n')
  let before: string | undefined
  try {
    before = readFileSync(file, 'utf8')
  } catch {
    // No report yet.
  }
  writeFileSync(file, bad ? text : '')
  if (!bad || before === text) return 0
  out(
    JSON.stringify({
      decision: 'block',
      reason:
        `ubq check: the tests do not show that the work is done.\n${text}\n` +
        'Do the steps above, then stop. If you cannot do a step, tell the user why.',
    }),
  )
  return 0
}
