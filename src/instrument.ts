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
  /**
   * The text that was added to each line, for `originalColumn`: line
   * number, then pairs of the column in the source (from 0) and the
   * length of the added text.
   */
  shifts: Record<number, number[]>
  /**
   * `code` with the types removed, each position the same. Only in a
   * cache entry that the background server made: a test process then
   * does not have to load the code that removes types.
   */
  js?: string
}

export interface Node {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

const parser = Parser.extend(tsPlugin() as never)
// In a `.tsx` or `.jsx` file, `<` can start an element. In a `.ts`
// file, it can start a type assertion.
const jsxParser = Parser.extend(tsPlugin({ jsx: true }) as never)
const JSX = /\.[jt]sx$/

/**
 * The syntax tree of a source file. Throws if no parser can read
 * it. Bun reads JSX in a `.js` file, so such a file gets a second
 * try with the JSX parser.
 */
export const parse = (source: string, file: string): Node => {
  const options = { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true } as const
  if (JSX.test(file)) return jsxParser.parse(source, options) as unknown as Node
  try {
    return parser.parse(source, options) as unknown as Node
  } catch (error) {
    if (!file.endsWith('.js')) throw error
    return jsxParser.parse(source, options) as unknown as Node
  }
}

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

export const children = (node: Node): Node[] => {
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
    program = parse(source, file)
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
  const shifts: Record<number, number[]> = {}
  let line = 1
  let lineStart = 0
  for (const e of edits) {
    for (let i = source.indexOf('\n', pos); i >= 0 && i < e.at; i = source.indexOf('\n', i + 1)) {
      line++
      lineStart = i + 1
    }
    code += source.slice(pos, e.at) + e.text
    pos = e.at
    ;(shifts[line] ??= []).push(e.at - lineStart, e.text.length)
  }
  return { code: code + source.slice(pos), regions, shifts }
}

/** One small change to a source file, for a mutation check. */
export interface Mutant {
  /** The text from `start` to `end` is replaced by `text`. */
  start: number
  end: number
  text: string
  /** The text that the change replaces. */
  from: string
  line: number
  column: number
}

const SWAPS: Record<string, string> = {
  '===': '!==',
  '!==': '===',
  '==': '!=',
  '!=': '==',
  '<': '<=',
  '<=': '<',
  '>': '>=',
  '>=': '>',
  '+': '-',
  '-': '+',
  '*': '/',
  '/': '*',
  '&&': '||',
  '||': '&&',
}

/** TypeScript nodes that have an expression that runs. */
const TS_VALUES = new Set(['TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression', 'TSTypeAssertion'])

/**
 * The changes that a mutation check can make to `source`: a
 * different operator, a different boolean or number, a `!` removed.
 * Returns undefined if the parser cannot read the source.
 */
export const mutants = (source: string, file: string): Mutant[] | undefined => {
  let program: Node
  try {
    program = parse(source, file)
  } catch {
    return undefined
  }
  const out: Mutant[] = []
  const add = (start: number, end: number, text: string): void => {
    const before = source.slice(0, start)
    const line = before.split('\n').length
    out.push({ start, end, text, from: source.slice(start, end), line, column: start - before.lastIndexOf('\n') })
  }
  const walk = (node: Node): void => {
    if (node.type.startsWith('TS')) {
      // Types do not run.
      if (TS_VALUES.has(node.type) && isNode(node.expression)) walk(node.expression)
      return
    }
    if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
      const operator = node.operator as string
      const left = node.left as Node
      const right = node.right as Node
      if (SWAPS[operator] && isNode(left) && isNode(right)) {
        // The operator is between the operands. A comment there can
        // contain the same characters.
        const gap = source
          .slice(left.end, right.start)
          .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, text => ' '.repeat(text.length))
        const at = gap.indexOf(operator)
        if (at >= 0) add(left.end + at, left.end + at + operator.length, SWAPS[operator])
      }
    } else if (node.type === 'Literal' && typeof node.value === 'boolean')
      add(node.start, node.end, String(!node.value))
    else if (node.type === 'Literal' && typeof node.value === 'number')
      add(node.start, node.end, node.value === 0 ? '1' : '0')
    else if (node.type === 'UnaryExpression' && node.operator === '!') add(node.start, node.start + 1, '')
    // A module path and a property name are not values of the program.
    for (const key in node) {
      if (key === 'source' || (key === 'key' && !node.computed)) continue
      const v = node[key]
      if (isNode(v)) walk(v)
      else if (Array.isArray(v)) for (const item of v) if (isNode(item)) walk(item)
    }
  }
  walk(program)
  return out.sort((a, b) => a.start - b.start)
}
