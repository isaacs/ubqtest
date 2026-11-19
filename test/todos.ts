// The code of a converted file with the full text of each TODO. A
// file has the full text only at the first TODO with that text.
// Most tests of the converter are about which TODO is at a place.
import { type Converted, todoComment } from '../src/convert.ts'

export const fullTodos = <T extends Converted | undefined>(result: T): T => {
  if (!result) return result
  const lines = result.code.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const todo = result.todos.find(t => t.line === i + 1)
    const indent = /^(\s*)\/\/ TODO\(ubq\): /.exec(lines[i]!)?.[1]
    if (!todo || indent === undefined) {
      out.push(lines[i]!)
      continue
    }
    // The other lines of the comment.
    while (/^\s*\/\/ (?!TODO\(ubq\))/.test(lines[i + 1] ?? '')) i++
    out.push(...todoComment(indent, todo.text).trimEnd().split('\n'))
  }
  return { ...result, code: out.join('\n') }
}
