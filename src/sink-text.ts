// The compact text sink: nothing for a pass, one block for each
// failure, one summary line. See docs/04-architecture.md, section 9.
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Failure, Location, Repeat, Since, Sink, TestId } from './events.ts'
import { annotation, inActions } from './annotate.ts'
import { paint } from './color.ts'
import { projectRoot } from './project.ts'

const sourceLine = (at: Location): string | undefined => {
  try {
    return readFileSync(join(projectRoot(), at.file), 'utf8').split('\n')[at.line - 1]?.trim()
  } catch {
    return undefined
  }
}

/** Type errors that get a block. A wrong type can give hundreds. */
const TYPE_ERRORS = 20

/** Lines of console output in a failure block, outside CI. */
const OUTPUT_LINES = 20

/** Blocks of failed tests and file errors in a run, outside CI. */
const FAILURES = 20

/** The most rows of the table of failures in the summary of a step of GitHub Actions. */
const SUMMARY_ROWS = 20

const loc = (at: Location): string => `${at.file}:${at.line}:${at.column}`

const indent = (text: string): string => '  ' + text.replaceAll('\n', '\n  ')

/** The most places that the `since` line of a failure names. */
const SINCE = 5

/** The line of a failure block that says what changed after the last pass of the test (D69). */
export const sinceLine = (s: Since, id: TestId): string =>
  s.changed.length
    ? `since run ${s.run}, where it passed, these lines that it runs changed: ${s.changed.slice(0, SINCE).join(', ')}${s.changed.length > SINCE ? `, and ${s.changed.length - SINCE} more` : ''}`
    : `since run ${s.run}, where it passed, no code that it runs changed. The cause is in its data or its environment, or it is flaky: ubq --repeat 10 '${id}'`

/**
 * A sink that writes compact text with `write`. With `all`, it
 * writes each failure block, also outside CI.
 */
export const textSink = (write: (text: string) => void, all = false): Sink => {
  // A run in GitHub Actions puts its failures in the view of the
  // changes (D71). Not a second print of stored failures.
  const annotate = inActions() && !all
  // The file of the summary of a step of GitHub Actions (D73): one
  // table of the failures, at the end of the run.
  const summary = all ? undefined : process.env.GITHUB_STEP_SUMMARY || undefined
  /** For the summary: the kind, the test or file, the message, the place, and the command that runs it again. */
  const rows: string[][] = []
  const row = (kind: string, what: string, failure: { message: string; at?: Location }, rerun = ''): void =>
    void (summary && rows.push([kind, what, failure.message.split('\n')[0]!, failure.at ? loc(failure.at) : '', rerun]))
  const starts = new Map<TestId, Location | undefined>()
  const skips: string[] = []
  const output = new Map<TestId, string>()
  let ci = false
  let run: number | undefined

  let typeErrors = 0
  let failures = 0
  /** False if the failure gets no block, because of the limit. */
  const shown = (): boolean => ++failures <= FAILURES || ci || all
  const repeats = new Map<TestId, Repeat>()
  const rate = (r: Repeat, what: string): string =>
    `  failed ${r.fails} of ${r.runs} times.${r.fails < r.runs ? ` The first ${what}:` : ''}`

  /** The command that runs a test again. */
  const rerunOf = (id: TestId): string => {
    const at = starts.get(id)
    // ubq: not measured: each test of the tests has a line
    return at ? `ubq ${at.file}:${at.line}` : `ubq '${id}'`
  }

  const block = (head: string, failure: Failure, id?: TestId, repeat?: Repeat, kept: string[] = []): void => {
    const lines = [head.replace(/^\S+/, paint), indent(failure.message)]
    if (repeat) lines.splice(1, 0, rate(repeat, id === undefined ? 'error' : 'failure'))
    if (failure.at) {
      lines.push(`  at ${loc(failure.at)}`)
      const source = sourceLine(failure.at)
      if (source) lines.push(`  > ${source.length > 100 ? source.slice(0, 100) + '…' : source}`)
    }
    if (failure.diff) lines.push(indent(failure.diff))
    if (failure.pending) lines.push(`  still open: ${failure.pending.join(', ')}`)
    for (const o of failure.opened ?? []) lines.push(`  ${o.type} opened at ${loc(o.at)}`)
    const text = id === undefined ? undefined : output.get(id)?.trimEnd()
    if (text) {
      // In CI, stdout is all that a reader has, so nothing is cut.
      const all = text.split('\n')
      const shown = ci ? all : all.slice(-OUTPUT_LINES)
      const cut = all.length - shown.length
      lines.push(`  output${cut ? ` (last ${shown.length} of ${all.length} lines)` : ''}:`)
      lines.push(indent(shown.map(l => `| ${l}`).join('\n')))
    }
    for (const frame of failure.stack?.slice(1) ?? []) lines.push(`  at ${loc(frame)}`)
    for (const dir of kept) lines.push(`  testdir: ${dir}`)
    if (failure.since && id !== undefined) lines.push(`  ${sinceLine(failure.since, id)}`)
    const at = id === undefined ? undefined : starts.get(id)
    if (at) lines.push(`  rerun: ubq ${at.file}:${at.line}`)
    if (annotate)
      write(
        annotation(
          'error',
          failure.at,
          head,
          [failure.message, failure.diff, at && `rerun: ubq ${at.file}:${at.line}`].filter(Boolean).join('\n'),
        ),
      )
    write(lines.join('\n') + '\n\n')
  }

  return event => {
    switch (event.type) {
      case 'run-start':
        run = event.run
        ci = event.ci
        // In CI, stdout is all that a reader has.
        if (event.ci)
          write(
            `ubq: ${event.runtime.name} ${event.runtime.version}, ${event.platform} ${event.arch}, ${event.command.join(' ')}\n`,
          )
        break
      case 'test-start':
        starts.set(event.id, event.at)
        break
      case 'output':
        if (event.id) output.set(event.id, (output.get(event.id) ?? '') + event.text)
        break
      case 'test-end':
        if (event.repeat) repeats.set(event.id, event.repeat)
        if (event.status === 'fail' && event.failure) {
          row('FAIL', event.id, event.failure, rerunOf(event.id))
          if (shown()) block(`FAIL ${event.id}`, event.failure, event.id, event.repeat, event.kept)
        } else if (event.status === 'skip') skips.push(`skip ${event.id}: ${event.reason}`)
        output.delete(event.id)
        break
      case 'late-failure':
        row('FAIL', event.id, event.failure, rerunOf(event.id))
        if (shown()) block(`FAIL ${event.id}`, event.failure, event.id, repeats.get(event.id))
        break
      case 'file-error':
        row('ERROR', event.file, event.failure, `ubq ${event.file}`)
        if (shown()) block(`ERROR ${event.file}`, event.failure, undefined, event.repeat)
        break
      case 'file-end':
        if (event.updated) write(`updated ${event.updated} snapshots: ubq-snapshots/${event.file}.snap\n`)
        break
      case 'hang': {
        const lines = [`HANG ${event.id}`]
        for (const o of event.opened) {
          lines.push(`  ${o.type} opened at ${loc(o.at)}`)
          const source = sourceLine(o.at)
          // ubq: not measured: no hang of the tests has a long line
          if (source) lines.push(`  > ${source.length > 100 ? source.slice(0, 100) + '…' : source}`)
        }
        write(lines.join('\n') + '\n\n')
        break
      }
      case 'type-error':
        row('TYPE', event.at?.file ?? '(no file)', {
          message: `${event.code}: ${event.message}`,
          ...(event.at && { at: event.at }),
        })
        if (++typeErrors <= TYPE_ERRORS || all)
          block(`TYPE ${event.at?.file ?? '(no file)'}`, {
            kind: 'error',
            message: `${event.code}: ${event.message}`,
            ...(event.at && { at: event.at }),
          })
        break
      case 'run-end': {
        if (failures > FAILURES && !ci && !all)
          write(
            `and ${failures - FAILURES} more failures.${run === undefined ? '' : ` For all of them: ubq failures ${run}`}\n`,
          )
        if (typeErrors > TYPE_ERRORS && !all)
          write(
            `and ${typeErrors - TYPE_ERRORS} more type errors.${run === undefined ? '' : ` For all of them: ubq failures ${run}`}\n`,
          )
        if (event.otherTypes)
          write(
            `note: ${event.otherTypes} type errors are in files that this run did not use. They are not part of this result. A run of all tests reports them: ubq\n`,
          )
        if (skips.length) write(skips.join('\n') + '\n')
        const parts = [`${event.fail} failed`, `${event.pass} passed`]
        if (event.errors) parts.unshift(`${event.errors} errors`)
        if (event.skip) parts.push(`${event.skip} skipped`)
        if (event.unselected) parts.push(`${event.unselected} not selected`)
        if (event.types) parts.push(`${event.types} type errors`)
        const stored = run === undefined ? '' : ` (run ${run})`
        const status = event.code ? 'fail' : 'pass'
        const result = `${status}: ${parts.join(', ')}${stored}`
        write(`${paint(status)}${result.slice(status.length)}\n`)
        if (summary) {
          const md = [`### ubq: ${result}`, '']
          if (rows.length) {
            md.push('| | Test or file | Failure | At | Run again |', '| --- | --- | --- | --- | --- |')
            for (const r of rows.slice(0, SUMMARY_ROWS))
              md.push(
                `| ${r.map((cell, i) => (i === 4 && cell ? `\`${cell}\`` : cell.replaceAll('|', '\\|'))).join(' | ')} |`,
              )
            if (rows.length > SUMMARY_ROWS)
              md.push(
                '',
                // ubq: not measured: each run of the tests is stored
                `And ${rows.length - SUMMARY_ROWS} more.${run === undefined ? '' : ` For all of them: \`ubq failures ${run}\``}`,
              )
            md.push('')
          }
          if (event.otherTypes) md.push(`- ${event.otherTypes} type errors in files that this run did not use.`)
          if (event.uncovered)
            md.push(`- ${event.uncovered} ranges of code in the files of this run ran in no test: \`ubq uncovered\``)
          try {
            appendFileSync(summary, md.join('\n').trimEnd() + '\n\n')
          } catch {
            // ubq: not measured: GitHub makes the file, and a step can write it
          }
        }
        break
      }
    }
  }
}
