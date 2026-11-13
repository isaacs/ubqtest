// Source counters on Node must give the same coverage answers as
// V8, which is the reference (D25). The fixture project has many
// kinds of control flow.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assert, test } from 'ubqtest'
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
  assert.match(sh('--import', `ubqtest/${preload}`, 'test/flow.test.ts'), /^pass: 0 failed, 13 passed/)
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

test('counters and V8 give the same answers on the fixture project', { timeout: 30000 }, () => {
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
  assert.match(sh('--import', 'ubqtest/counters-preload', 'test/flow.test.ts'), /^pass: 0 failed, 13 passed/)
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
