// Source counters on Node must give the same coverage answers as
// V8, which is the reference (D25). The fixture project has many
// kinds of control flow.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { assert, cleanup, test } from 'ubqtest'
import { fixtures, resetStore } from './setup.ts'

const cwd = `${fixtures}diff/`
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const FILE = 'src/flow.ts'
const source = readFileSync(cwd + FILE, 'utf8')

const sh = (...args: string[]): string => {
  const r = spawnSync('node', args, { cwd, encoding: 'utf8' })
  assert.equal(r.stderr, '')
  return r.stdout
}

interface Answers {
  /** Lines that have code that no test ran. */
  uncovered: number[]
  /** For each line with code: the tests that ran it. `(load)` is the load of the file. */
  covers: Record<number, string[]>
  mode: string
}

const answers = (preload: string): Answers => {
  resetStore(cwd)
  assert.match(sh('--import', `ubqtest/${preload}`, 'test/flow.test.ts'), /^pass: 13 tests/m)
  const uncovered = new Set<number>()
  for (const line of sh(cli, 'uncovered', FILE).split('\n')) {
    const m = /^[^:]+:(\d+):\d+ .*?(?: \(\+(\d+) lines\))?$/.exec(line)
    if (m) for (let i = 0; i <= +(m[2] ?? 0); i++) uncovered.add(+m[1]! + i)
  }
  // The offsets of the code on each line, without the space around it.
  const lines: [line: number, start: number, end: number][] = []
  let offset = 0
  source.split('\n').forEach((text, i) => {
    const trimmed = text.trim()
    if (trimmed) lines.push([i + 1, offset + text.indexOf(trimmed), offset + text.indexOf(trimmed) + trimmed.length])
    offset += text.length + 1
  })
  const covers: Record<number, string[]> = {}
  const rows = sh(cli, 'sql', `select test, ranges from coverage where file = '${FILE}' order by test`)
  for (const row of rows.trim().split('\n')) {
    const { test: id, ranges } = JSON.parse(row) as { test: string; ranges: string }
    const r = JSON.parse(ranges) as number[]
    for (const [line, start, end] of lines)
      for (let i = 0; i < r.length; i += 3)
        if (r[i + 2] && r[i]! < end && r[i + 1]! > start) {
          ;(covers[line] ??= []).push(id.replace(/^.* > /, '') || '(load)')
          break
        }
  }
  const mode = sh(cli, 'sql', 'select coverage from test_file').trim()
  return { uncovered: [...uncovered].sort((a, b) => a - b), covers, mode }
}

// V8 12, of Node 22, gives other ranges for a class. The list of
// accepted differences below is for V8 13 and later.
const oldV8 = +(process.versions.v8 ?? '13').split('.')[0]! < 13 && 'V8 12 gives other ranges for a class'

test('counters and V8 give the same answers on the fixture project', { skip: oldV8 }, () => {
  const v8 = answers('preload')
  const counters = answers('counters-preload')
  resetStore(cwd)
  assert.equal(v8.mode, '{"coverage":"full"}')
  assert.equal(counters.mode, '{"coverage":"full"}')
  assert.deepEqual(counters.uncovered, v8.uncovered)

  // The accepted differences. Each one needs a reason.
  const text = (n: number): string => source.split('\n')[n - 1]!.trim()
  const differ: Record<string, { v8: string[]; counters: string[] }> = {}
  for (const line of new Set([...Object.keys(v8.covers), ...Object.keys(counters.covers)].map(Number))) {
    const [a, b] = [v8.covers[line] ?? [], counters.covers[line] ?? []]
    if (a.join() !== b.join()) differ[text(line)] = { v8: a, counters: b }
  }
  assert.deepEqual(differ, {
    // A class field with no value has no code to count. V8 counts
    // it as code of each new object.
    '#value: T': { v8: ['(load)', 'box'], counters: ['(load)'] },
    // The name of a method is in the region of the method. V8
    // counts the name as code of the class, which runs at load.
    'static empty(): Box<undefined> {': { v8: ['(load)'], counters: [] },
  })
})

test('the cache holds the changed source, and a second run reads it', () => {
  const dir = `${cwd}.ubq/counters`
  resetStore(cwd)
  sh('--import', 'ubqtest/counters-preload', 'test/flow.test.ts')
  assert(existsSync(dir))
  const files = readdirSync(dir)
  // The source file and the test file.
  assert.equal(files.length, 2)
  assert.match(sh('--import', 'ubqtest/counters-preload', 'test/flow.test.ts'), /^pass: 13 tests/m)
  assert.deepEqual(readdirSync(dir), files)
  resetStore(cwd)
})

test('a body with only a directive, and no `;` after it', async () => {
  const { instrument, parse } = await import('../src/instrument.ts')
  // The form of a minified bundle.
  for (const source of ['var f=()=>{"use strict"};f()', '"use strict"', 'function g(){"use strict";"second"}g()']) {
    const changed = instrument(source, 'a.js')
    assert(changed)
    // The text with counters is code, and the directive is first.
    parse(changed.code, 'a.js')
    assert.match(changed.code, /"use strict";/)
  }
})

test('assert at the start of the line after an import is a statement', async () => {
  const { parse } = await import('../src/instrument.ts')
  for (const file of ['a.ts', 'a.tsx']) {
    const body = parse("import assert from 'node:assert'\nassert(true)\n", file).body as { type: string }[]
    assert.deepEqual(
      body.map(n => n.type),
      ['ImportDeclaration', 'ExpressionStatement'],
    )
  }
  // On the line of the import, it is an import assertion.
  const body = parse("import a from './a.json' assert { type: 'json' }\n", 'a.ts').body as { type: string }[]
  assert.equal(body.length, 1)
})

test('a TypeScript file that fails also with its types removed gives the first error', async () => {
  const { parse } = await import('../src/instrument.ts')
  // Node removes the types, but the parser refuses the second `a`.
  assert.throws(
    () => parse('let a: number = 1\nlet a = 2\n', 'a.ts'),
    /Identifier 'a' has already been declared \(2:4\)/,
  )
})

test('an arrow function with one type parameter parses in a .tsx file', async () => {
  const { parse } = await import('../src/instrument.ts')
  const body = parse('const f = <T extends object>(v: T): T => v\nconst el = <a>{f}</a>\n', 'a.tsx').body as {
    declarations: { init: { type: string } }[]
  }[]
  assert.deepEqual(
    body.map(n => n.declarations[0]!.init.type),
    ['ArrowFunctionExpression', 'JSXElement'],
  )
})

// This file has counters, so its functions have them too.
const pick = (n: number) => (n > 0 ? 'a' : n || 'b')
function first(list: number[]) {
  for (const n of list) if (n) return n
  if (list.length) return 1
  else return 0
}
class Box {
  value = 1
  static of(n = 1) {
    return n ?? 2
  }
}

test('the text of a function has no counters, and it runs in a place that has none', () => {
  for (const fn of [pick, first, Box, Box.of]) assert(!String(fn).includes('__ubqc'), String(fn))
  assert.equal(new Function(`return (${pick})(1)`)(), 'a')
  assert.equal(new Function(`return (${first})([0, 3])`)(), 3)
  // The function looks like one of the runtime.
  const real = (name: string): string => String(Math.max).replace('max', name)
  assert.equal(String(Function.prototype.toString), real('toString'))
  assert.equal(Function.prototype.toString.name, 'toString')
  assert(!('prototype' in Function.prototype.toString))
})

test(
  'the text of a function is its text in the source',
  { skip: !!(process.versions.bun || process.versions.deno) && 'Bun and Deno print the code again' },
  () => {
    const own = readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/: number(\[\])?/g, m =>
      ' '.repeat(m.length),
    )
    for (const fn of [pick, first, Box, Box.of]) assert(own.includes(String(fn)), String(fn))
  },
)

test('hideCounters replaces toString one time, and keeps a function with no counters as it is', async () => {
  // A copy of the module, which has counters: the library loaded the
  // module before the counters started.
  const { hideCounters, originalColumn }: typeof import('../src/counters.ts') = await import(
    '../src/counters.ts?copy' as string
  )
  const key = Symbol.for('ubqtest.toString')
  const shared = globalThis as Record<symbol, unknown>
  const now = Function.prototype.toString
  cleanup(() => {
    Function.prototype.toString = now
    shared[key] = true
  })
  // With the mark, a second call changes nothing.
  hideCounters()
  assert.equal(Function.prototype.toString, now)
  // The toString of a different realm shows the counters.
  const raw = runInNewContext('Function.prototype.toString') as typeof now
  Function.prototype.toString = raw
  delete shared[key]
  hideCounters()
  const made = Function.prototype.toString
  assert.notEqual(made, raw)
  assert.equal(made.call(made), now.call(Math.max).replace('max', 'toString'))
  // Text with no counters stays as it is.
  const plain = new Function('a', 'return a ? 1 : 2')
  assert.equal(made.call(plain), now.call(plain))
  // A function of the copy has counters.
  assert(!made.call(originalColumn).includes('__ubqc'), made.call(originalColumn))
})
