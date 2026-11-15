// `ubq report`: what the tests show about a change, as markdown that
// an agent puts in its last message or in a pull request (D72). A
// person reads it, and does not run a command.
import { checkResult } from './check.ts'
import { diffOption, headCommit } from './git.ts'
import { runCounts, runRow } from './query.ts'
import { reviewItems } from './review.ts'
import { UsageError } from './runner.ts'
import { openStore } from './store.ts'

const block = (lines: string[]): string[] => ['', '```text', ...lines, '```']

/** Prints the report. The exit code is 0: `ubq check` is the command that fails. */
export const report = (args: string[], out: (line: string) => void): number => {
  const rest = [...args]
  const diff = diffOption(rest)
  if (rest.length) throw new UsageError(`ubq report takes --diff=<commit>, not: ${rest.join(' ')}`)
  const lines = ['### Tests', '']

  // The result: is the last result of the tests that of the code now?
  const check = checkResult(diff)
  const [, verdict, ...why] = check.result.split(': ')
  lines.push(`**${verdict}**: ${why.join(': ')}`)
  if (check.report.length) lines.push(...block(check.report))

  // The last run, if it ended.
  if (check.run !== undefined) {
    const store = openStore()
    const row = runRow(store.db, check.run)!
    store.close()
    if (row.code !== null) lines.push('', `- Last run (run ${row.id}): ${runCounts(row).join(', ')}.`)
  }

  // The changes to the tests that a person must look at.
  if (diff !== undefined || headCommit()) {
    const review = reviewItems(diff)
    lines.push(
      `- Changes to the tests to look at (\`ubq review\`, from ${review.from}): ${review.items.length || 'none'}.`,
    )
    if (review.items.length || review.notes.length) lines.push(...block([...review.items.flat(), ...review.notes]))
  }
  for (const line of lines) out(line)
  return 0
}
