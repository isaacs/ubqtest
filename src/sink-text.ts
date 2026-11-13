// The compact text sink: nothing for a pass, one block for each
// failure, one summary line. See docs/04-architecture.md, section 9.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Failure, Location, Repeat, Sink, TestId } from './events.ts'
import { projectRoot } from './project.ts'

const sourceLine = (at: Location): string | undefined => {
  try {
    return readFileSync(join(projectRoot(), at.file), 'utf8')
      .split('\n')
      [at.line - 1]?.trim()
  } catch {
    return undefined
  }
}

/** Type errors that get a block. A wrong type can give hundreds. */
const TYPE_ERRORS = 20

/** Lines of console output in a failure block, outside CI. */
const OUTPUT_LINES = 20

const loc = (at: Location): string => `${at.file}:${at.line}:${at.column}`

const indent = (text: string): string => '  ' + text.replaceAll('\n', '\n  ')

/** A sink that writes compact text with `write`. */
export const textSink = (write: (text: string) => void): Sink => {
  const starts = new Map<TestId, Location | undefined>()
  const skips: string[] = []
  const output = new Map<TestId, string>()
  let ci = false
  let run: number | undefined

  let typeErrors = 0
  const repeats = new Map<TestId, Repeat>()
  const rate = (r: Repeat, what: string): string =>
    `  failed ${r.fails} of ${r.runs} times.${r.fails < r.runs ? ` The first ${what}:` : ''}`

  const block = (
    head: string,
    failure: Failure,
    id?: TestId,
    repeat?: Repeat,
    kept: string[] = [],
  ): void => {
    const lines = [head, indent(failure.message)]
    if (repeat) lines.splice(1, 0, rate(repeat, id === undefined ? 'error' : 'failure'))
    if (failure.at) {
      lines.push(`  at ${loc(failure.at)}`)
      const source = sourceLine(failure.at)
      if (source)
        lines.push(
          `  > ${source.length > 100 ? source.slice(0, 100) + '…' : source}`,
        )
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
    for (const frame of failure.stack?.slice(1) ?? [])
      lines.push(`  at ${loc(frame)}`)
    for (const dir of kept) lines.push(`  testdir: ${dir}`)
    const at = id === undefined ? undefined : starts.get(id)
    if (at) lines.push(`  rerun: ubq ${at.file}:${at.line}`)
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
        if (event.status === 'fail' && event.failure)
          block(`FAIL ${event.id}`, event.failure, event.id, event.repeat, event.kept)
        else if (event.status === 'skip')
          skips.push(`skip ${event.id}: ${event.reason}`)
        output.delete(event.id)
        break
      case 'late-failure':
        block(`FAIL ${event.id}`, event.failure, event.id, repeats.get(event.id))
        break
      case 'file-error':
        block(`ERROR ${event.file}`, event.failure, undefined, event.repeat)
        break
      case 'file-end':
        if (event.updated)
          write(`updated ${event.updated} snapshots: ubq-snapshots/${event.file}.snap\n`)
        break
      case 'hang': {
        const lines = [`HANG ${event.id}`]
        for (const o of event.opened) {
          lines.push(`  ${o.type} opened at ${loc(o.at)}`)
          const source = sourceLine(o.at)
          if (source) lines.push(`  > ${source.length > 100 ? source.slice(0, 100) + '…' : source}`)
        }
        write(lines.join('\n') + '\n\n')
        break
      }
      case 'type-error':
        if (++typeErrors <= TYPE_ERRORS)
          block(`TYPE ${event.at?.file ?? '(no file)'}`, {
            kind: 'error',
            message: `${event.code}: ${event.message}`,
            ...(event.at && { at: event.at }),
          })
        break
      case 'run-end': {
        if (typeErrors > TYPE_ERRORS)
          write(`and ${typeErrors - TYPE_ERRORS} more type errors. For all of them: npx tsc --noEmit\n`)
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
        write(`${event.code ? 'fail' : 'pass'}: ${parts.join(', ')}${stored}\n`)
        break
      }
    }
  }
}
