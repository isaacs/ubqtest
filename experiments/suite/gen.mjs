// Generate the same suite for each framework.
// usage: node gen.mjs <files> <testsPerFile>
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
const [F, T] = [+process.argv[2], +process.argv[3]]
const S = 20
rmSync('src', { recursive: true, force: true })
mkdirSync('src', { recursive: true })
for (let i = 0; i < S; i++) {
  let s = i ? `import { calc0 } from './m0.ts'\n` : ''
  for (let j = 0; j < 20; j++) s += `export function calc${j}${i ? '_' + i : ''}(a: number, b: number): { sum: number; tag: string } {
  const sum = a > b ? a - b + ${j} : b - a + ${j}
  return { sum, tag: sum % 2 ? 'odd' : 'even' }
}
`
  writeFileSync(`src/m${i}.ts`, s)
}
const body = (f, t, eq) => { const i = f % S, j = t % 20; const fn = `m.calc${j}${i ? '_' + i : ''}`; return eq(`${fn}(${t + 5}, 2)`, `{ sum: ${t + 3 + j}, tag: '${(t + 3 + j) % 2 ? 'odd' : 'even'}' }`) }
const kinds = {
  nodetest: { head: `import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n`, test: (n, b) => `test('${n}', () => {\n  ${b}\n})\n`, eq: (a, e) => `assert.deepEqual(${a}, ${e})`, ext: 'test.ts' },
  vitest: { head: `import { test, expect } from 'vitest'\n`, test: (n, b) => `test('${n}', () => {\n  ${b}\n})\n`, eq: (a, e) => `expect(${a}).toEqual(${e})`, ext: 'test.ts' },
  jest: { head: ``, test: (n, b) => `test('${n}', () => {\n  ${b}\n})\n`, eq: (a, e) => `expect(${a}).toEqual(${e})`, ext: 'test.ts' },
  tap: { head: `import t from 'tap'\n`, test: (n, b) => `t.test('${n}', async t => {\n  ${b}\n})\n`, eq: (a, e) => `t.strictSame(${a}, ${e})`, ext: 'test.ts' },
  proto: { head: `import { test } from '../../proto/lib.mjs'\n`, test: (n, b) => `test('${n}', t => {\n  ${b}\n})\n`, eq: (a, e) => `t.deepEqual(${a}, ${e})`, ext: 'test.ts' },
  ubq: { head: `import { test, assert } from '../../../dist/index.js'\n`, test: (n, b) => `test('${n}', () => {\n  ${b}\n})\n`, eq: (a, e) => `assert.deepEqual(${a}, ${e})`, ext: 'test.ts' },
  bun: { head: `import { test, expect } from 'bun:test'\n`, test: (n, b) => `test('${n}', () => {\n  ${b}\n})\n`, eq: (a, e) => `expect(${a}).toEqual(${e})`, ext: 'test.ts' },
  deno: { head: `import assert from 'node:assert/strict'\n`, test: (n, b) => `Deno.test('${n}', () => {\n  ${b}\n})\n`, eq: (a, e) => `assert.deepEqual(${a}, ${e})`, ext: 'test.ts' },
}
for (const [k, d] of Object.entries(kinds)) {
  rmSync(`t-${k}`, { recursive: true, force: true })
  mkdirSync(`t-${k}`, { recursive: true })
  for (let f = 0; f < F; f++) {
    const i = f % S
    let s = d.head + `import * as m from '../src/m${i}.ts'\n\n`
    for (let t = 0; t < T; t++) s += d.test(`file ${f} test ${t}`, body(f, t, d.eq)) + '\n'
    writeFileSync(`t-${k}/f${f}.${d.ext}`, s)
  }
}
