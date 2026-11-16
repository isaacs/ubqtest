// `ubq report`: what the tests show about a change, as markdown that
// an agent puts in its last message or in a pull request (D72). A
// person reads it, and does not run a command.
import { checkResult } from './check.ts'
import { diffOption, headCommit } from './git.ts'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from './project.ts'
import { reviewItems } from './review.ts'
import { LAST_RESULTS, UsageError } from './runner.ts'
import { openStore } from './store.ts'

const block = (lines: string[]): string[] => ['', '```text', ...lines, '```']

/** Prints the report. The exit code is 0: `ubq check` is the command that fails. */
export const report = (args: string[], out: (line: string) => void): number => {
  const rest = [...args]
  const diff = diffOption(rest)
  if (rest.length) throw new UsageError(`ubq report takes --diff=<commit>, not: ${rest.join(' ')}`)
  // The result: is the last result of the tests that of the code now?
  // A pass is one line: the count of tests that pass.
  const check = checkResult(diff)
  const [, verdict, ...why] = check.result.split(': ')
  const lines: string[] = []
  if (verdict === 'pass') {
    const store = openStore()
    const files = store.db
      .prepare(`select file, count(*) n from (${LAST_RESULTS}) where status = 'pass' group by file`)
      .all() as { file: string; n: number }[]
    store.close()
    const n = files.filter(f => existsSync(join(projectRoot(), f.file))).reduce((sum, f) => sum + f.n, 0)
    const changed = diff !== undefined || headCommit() ? ', and each changed line ran in a test' : ''
    lines.push(`**pass**: ${n} tests pass on the code as it is now${changed}.`)
  } else {
    lines.push('### Tests', '', `**${verdict}**: ${why.join(': ')}`)
    if (check.report.length) lines.push(...block(check.report))
  }

  // The changes to the tests that a person must look at, if some.
  if (diff !== undefined || headCommit()) {
    const review = reviewItems(diff)
    if (review.items.length) lines.push('', `- Changes to the tests to look at: ${review.items.length}.`)
    if (review.items.length || review.notes.length) lines.push(...block([...review.items.flat(), ...review.notes]))
  }
  for (const line of lines) out(line)
  return 0
}
