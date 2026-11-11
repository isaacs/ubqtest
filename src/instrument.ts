// Source counters: coverage for a runtime with no V8 inspector (Bun).
// Adds a counter to each function and each branch of a source file.
// See docs/04-architecture.md, section 4.
import { tsPlugin } from '@sveltejs/acorn-typescript'
import { Parser } from 'acorn'

/** The name of the counter array in a changed file. */
const NAME = '__ubqc'

/** The key of the global Map from file path to counter array. */
export const COUNTERS = 'ubqtest.counters'

/** The part of the source that one counter stands for. */
export interface Region {
  start: number
  end: number
  /** True for a function or the module. False for a branch. */
  fn: boolean
  /** Index of the nearest function region around this one. -1 for the module. */
  parent: number
}

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
  const statement = (node: Node | null | undefined, fn: number): void => {
    if (!node) return
    if (node.type === 'BlockStatement') edit(node.start + 1, `${region(node, false, fn)};`)
    else {
      edit(node.start, `{${region(node, false, fn)};`)
      edit(node.end, '}', true)
    }
  }
  /** A counter in front of an expression that is a branch. */
  const expression = (node: Node, fn: number): void => {
    edit(node.start, `(${region(node, false, fn)},`)
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

  const walk = (node: Node, fn: number): void => {
    let inner = fn
    if (FUNCTIONS.has(node.type) && isNode(node.body)) {
      const body = node.body
      const count = region(node, true, fn)
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
        statement(node.alternate as Node | null, inner)
        break
      case 'ConditionalExpression':
        expression(node.consequent as Node, inner)
        expression(node.alternate as Node, inner)
        break
      case 'LogicalExpression':
        expression(node.right as Node, inner)
        break
      case 'SwitchCase': {
        const first = (node.consequent as Node[])[0]
        if (first) edit(first.start, `${region(node, false, inner, first.start)};`)
        list(node.consequent as Node[], inner)
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
    for (const child of children(node)) walk(child, inner)
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

/**
 * The regions of a file as V8-style ranges for `flatten`, with the
 * counts since the last call. Sets the counters to zero.
 *
 * `all` is true for the first snapshot of a file: it lists each
 * region, so that code that never runs is known. A later snapshot
 * lists only functions that ran, with their branches and with the
 * functions directly in them.
 */
export const snapshot = (
  regions: Region[],
  counts: Uint32Array,
  all: boolean,
): { startOffset: number; endOffset: number; count: number }[] => {
  const out: { startOffset: number; endOffset: number; count: number }[] = []
  regions.forEach((r, i) => {
    const ran = r.fn && counts[i]! > 0
    const parentRan = r.parent >= 0 && counts[r.parent]! > 0
    if (all || ran || parentRan)
      out.push({ startOffset: r.start, endOffset: r.end, count: counts[i]! })
  })
  counts.fill(0)
  return out
}
