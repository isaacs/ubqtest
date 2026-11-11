// Stack traces as lists of user code locations.
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Location } from './events.ts'
import { rel } from './project.ts'

const own = import.meta.dirname + sep

// `at fn (file:///a/b.ts:1:2)`, `at file:///a/b.ts:1:2`, `at fn (/a/b.ts:1:2)`
// Bun omits the column of some frames: `at /a/b.ts:1`
const frame = /(?:\(|at (?:async )?)((?:file:\/\/)?\/[^\s()]+?):(\d+)(?::(\d+))?\)?$/

/** The frames of `stack` that are in user code, innermost first. */
export const userFrames = (stack: string | undefined, limit = 6): Location[] => {
  const out: Location[] = []
  if (!stack) return out
  for (const line of stack.split('\n')) {
    const m = frame.exec(line.trimEnd())
    if (!m) continue
    const raw = m[1]!.replace(/\?[^:]*$/, '')
    const path = raw.startsWith('file://') ? fileURLToPath(raw) : raw
    if (path.startsWith(own) || path.includes(`${sep}node_modules${sep}`)) continue
    out.push({ file: rel(path), line: +m[2]!, column: +(m[3] ?? 1) })
    if (out.length === limit) break
  }
  return out
}

/** The user code location that called into the library. */
export const callSite = (): Location | undefined => userFrames(new Error().stack, 1)[0]
