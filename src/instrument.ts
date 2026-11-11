// Source counters: coverage for a runtime with no V8 inspector (Bun).
// Adds a counter to each function and each branch of a source file.
// See docs/04-architecture.md, section 4.
import { tsPlugin } from '@sveltejs/acorn-typescript'
import { Parser } from 'acorn'
import { COUNTERS, type Region } from './counters.ts'

/** The name of the counter array in a changed file. */
const NAME = '__ubqc'

export interface Instrumented {
  /** The source with counters. Each line has the same number as before. */
  code: string
  /** `regions[i]` is the region of counter `i`. Region 0 is the module. */
  regions: Region[]
}

interface Node {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

const parser = Parser.extend(tsPlugin() as never)

const FUNCTIONS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
])
const LOOPS = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
])
const JUMPS = new Set([
  'ReturnStatement',
  'ThrowStatement',
  'BreakStatement',
  'ContinueStatement',
])

const isNode = (v: unknown): v is Node =>
  typeof v === 'object' && v !== null && typeof (v as Node).type === 'string'

const children = (node: Node): Node[] => {
  const out: Node[] = []
  for (const key in node) {
    const v = node[key]
    if (isNode(v)) out.push(v)
    else if (Array.isArray(v)) for (const item of v) if (isNode(item)) out.push(item)
  }
  return out
}

/** True if the code of `node` can leave its block early. */
const jumps = (node: Node): boolean =>
  JUMPS.has(node.type) ||
  (!FUNCTIONS.has(node.type) && children(node).some(jumps))

/**
 * Adds counters to `source`. Returns undefined if the parser cannot
 * read the source. `file` is the key of the counter array.
 */
export const instrument = (source: string, file: string): Instrumented | undefined => {
  let program: Node
  try {
    program = parser.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      allowHashBang: true,
    }) as unknown as Node
  } catch {
    return undefined
  }

  const regions: Region[] = [{ start: 0, end: source.length, fn: true, parent: -1 }]
  // Text to insert. An `open` goes before code, a `close` goes after.
  const edits: { at: number; text: string; close: boolean; seq: number }[] = []
  const edit = (at: number, text: string, close = false): void => {
    edits.push({ at, text, close, seq: edits.length })
  }
  const region = (node: Node, fn: boolean, parent: number, start = node.start): string => {
    regions.push({ start, end: node.end, fn, parent })
    return `${NAME}[${regions.length - 1}]++`
  }

  /** The position after the directives (`'use strict'`) of a body. */
  const afterDirectives = (body: Node[], fallback: number): number => {
    const first = body.find(s => typeof s.directive !== 'string')
    return first ? first.start : (body.at(-1)?.end ?? fallback)
  }
  /** A counter at the start of a statement that is a branch or a loop body. */
  // `from` is the start of the region, if the region has text in
  // front of the node: `else`, `?`, `:`. That text does not run
  // unless the branch does.
  const statement = (node: Node | null | undefined, fn: number, from?: number): void => {
    if (!node) return
    if (node.type === 'BlockStatement')
      edit(node.start + 1, `${region(node, false, fn, from)};`)
    else {
      edit(node.start, `{${region(node, false, fn, from)};`)
      edit(node.end, '}', true)
    }
  }
  /** A counter in front of an expression that is a branch. */
  const expression = (node: Node, fn: number, from?: number, isFn = false): void => {
    edit(node.start, `(${region(node, isFn, fn, from)},`)
    edit(node.end, ')', true)
  }
  /**
   * In a list of statements, the code after a statement that can
   * leave early gets its own counter, because it does not always run.
   */
  const list = (body: Node[], fn: number): void => {
    const end = body.at(-1)?.end ?? 0
    body.forEach((s, i) => {
      const next = body[i + 1]
      if (next && jumps(s)) {
        regions.push({ start: next.start, end, fn: false, parent: fn })
        edit(next.start, `${NAME}[${regions.length - 1}]++;`)
      }
    })
  }

  // `from` is the start of the region of a method: its name.
  const walk = (node: Node, fn: number, from?: number): void => {
    let inner = fn
    if (FUNCTIONS.has(node.type) && isNode(node.body)) {
      const body = node.body
      const count = region(node, true, fn, from)
      inner = regions.length - 1
      if (body.type === 'BlockStatement') {
        const stmts = body.body as Node[]
        edit(afterDirectives(stmts, body.start + 1), `${count};`)
      } else {
        edit(body.start, `(${count},`)
        edit(body.end, ')', true)
      }
    }
    switch (node.type) {
      case 'IfStatement':
        statement(node.consequent as Node, inner)
        statement(node.alternate as Node | null, inner, (node.consequent as Node).end)
        break
      case 'ConditionalExpression':
        expression(node.consequent as Node, inner, (node.test as Node).end)
        expression(node.alternate as Node, inner, (node.consequent as Node).end)
        break
      case 'LogicalExpression':
        expression(node.right as Node, inner, (node.left as Node).end)
        break
      case 'SwitchCase': {
        const first = (node.consequent as Node[])[0]
        if (first) edit(first.start, `${region(node, false, inner)};`)
        list(node.consequent as Node[], inner)
        break
      }
      case 'PropertyDefinition': {
        // The value of a class field runs for each new object. A
        // function or a class has its own counter, and a wrap would
        // remove the name that it gets from the field.
        const value = node.value
        if (isNode(value) && !FUNCTIONS.has(value.type) && value.type !== 'ClassExpression')
          expression(value, inner, undefined, true)
        break
      }
      case 'CatchClause':
        statement(node.body as Node, inner)
        break
      case 'Program':
      case 'BlockStatement':
        list(node.body as Node[], inner)
        break
      default:
        if (LOOPS.has(node.type)) statement(node.body as Node, inner)
    }
    const method =
      node.type === 'MethodDefinition' ||
      (node.type === 'Property' && (node.method === true || node.kind !== 'init'))
    for (const child of children(node))
      walk(child, inner, method && child === node.value ? node.start : undefined)
  }
  walk(program, 0)

  const start = afterDirectives(program.body as Node[], source.length)
  edit(
    start,
    `const ${NAME}=globalThis[Symbol.for(${JSON.stringify(COUNTERS)})].get(${JSON.stringify(file)});${NAME}[0]++;`,
  )
  // The prelude must come first at its position.
  edits.at(-1)!.seq = -1

  // At one position: text that closes goes before text that opens.
  // Inner closes go before outer closes. Outer opens go before inner.
  edits.sort(
    (a, b) =>
      a.at - b.at ||
      +b.close - +a.close ||
      (a.close ? b.seq - a.seq : a.seq - b.seq),
  )
  let code = ''
  let pos = 0
  for (const e of edits) {
    code += source.slice(pos, e.at) + e.text
    pos = e.at
  }
  return { code: code + source.slice(pos), regions }
}
