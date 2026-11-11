// The compact text sink: nothing for a pass, one block for each
// failure, one summary line. See docs/04-architecture.md, section 9.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Failure, Location, Sink, TestId } from './events.ts'
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

const loc = (at: Location): string => `${at.file}:${at.line}:${at.column}`

const indent = (text: string): string => '  ' + text.replaceAll('\n', '\n  ')

/** A sink that writes compact text with `write`. */
export const textSink = (write: (text: string) => void): Sink => {
  const starts = new Map<TestId, Location | undefined>()
  const skips: string[] = []
  let run: number | undefined

  const block = (head: string, failure: Failure, id?: TestId): void => {
    const lines = [head, indent(failure.message)]
    if (failure.at) {
      lines.push(`  at ${loc(failure.at)}`)
      const source = sourceLine(failure.at)
      if (source)
        lines.push(
          `  > ${source.length > 100 ? source.slice(0, 100) + '…' : source}`,
        )
    }
    if (failure.diff) lines.push(indent(failure.diff))
    for (const frame of failure.stack?.slice(1) ?? [])
      lines.push(`  at ${loc(frame)}`)
    const at = id === undefined ? undefined : starts.get(id)
    if (at) lines.push(`  rerun: ubq ${at.file}:${at.line}`)
    write(lines.join('\n') + '\n\n')
  }

  return event => {
    switch (event.type) {
      case 'run-start':
        run = event.run
        // In CI, stdout is all that a reader has.
        if (event.ci)
          write(
            `ubq: ${event.runtime.name} ${event.runtime.version}, ${event.platform} ${event.arch}, ${event.command.join(' ')}\n`,
          )
        break
      case 'test-start':
        starts.set(event.id, event.at)
        break
      case 'test-end':
        if (event.status === 'fail' && event.failure)
          block(`FAIL ${event.id}`, event.failure, event.id)
        else if (event.status === 'skip')
          skips.push(`skip ${event.id}: ${event.reason}`)
        break
      case 'late-failure':
        block(`FAIL ${event.id}`, event.failure, event.id)
        break
      case 'file-error':
        block(`ERROR ${event.file}`, event.failure)
        break
      case 'run-end': {
        if (skips.length) write(skips.join('\n') + '\n')
        const parts = [`${event.fail} failed`, `${event.pass} passed`]
        if (event.errors) parts.unshift(`${event.errors} errors`)
        if (event.skip) parts.push(`${event.skip} skipped`)
        if (event.unselected) parts.push(`${event.unselected} not selected`)
        const stored = run === undefined ? '' : ` (run ${run})`
        write(`${event.code ? 'fail' : 'pass'}: ${parts.join(', ')}${stored}\n`)
        break
      }
    }
  }
}
