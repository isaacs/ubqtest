// `ubq mutate`: the mutation check.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { mutants } from '../src/instrument.ts'
import { project } from './setup.ts'

const SOURCE = `export const price = (cents: number, coupon?: string): number => {
  if (coupon === 'FIVEOFF') return Math.max(0, cents - 500)
  return cents
}
export const never = (): boolean => !price(1)
`
const TEST = `import { assert, test } from 'ubqtest'
import { price } from './src/price.ts'
test('no coupon', () => {
  assert.equal(price(700), 700)
})
test('five off', () => {
  assert.equal(price(1200, 'FIVEOFF'), 700)
})
`

test('the changes of a source: operators, numbers, booleans, and not types', () => {
  const list = mutants(`const a: 0 | 1 = x === 1 ? 0 : (y as number) + 2 // a - b
const b = !a && { 1: true }[1] /* || */ || import('./x.ts')
`)
  assert(list)
  assert.deepEqual(
    list.map(m => `${m.line}:${m.column} ${m.from} ${m.text}`),
    [
      '1:20 === !==',
      '1:24 1 0',
      '1:28 0 1',
      '1:46 + -',
      '1:48 2 0',
      '2:11 ! ',
      '2:14 && ||',
      '2:22 true false',
      '2:29 1 0',
      '2:41 || &&',
    ],
  )
  assert.equal(mutants('const = 1'), undefined)
})

test('mutate lists each change that no test fails for, and does not change the file', { timeout: 30_000 }, () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  mkdirSync(join(p.dir, 'src'), { recursive: true })
  writeFileSync(join(p.dir, 'src/price.ts'), SOURCE)
  writeFileSync(join(p.dir, 'price.test.ts'), TEST)
  assert.deepEqual([p.ubq('mutate', 'src/price.ts').code, p.ubq('price.test.ts').last], [4, 'pass: 0 failed, 2 passed'])
  /** The summary of a check. */
  const mutate = (...args: string[]) => p.ubq('mutate', ...args).out.trimEnd().split('\n').at(-1)
  const r = p.ubq('mutate', 'src/price.ts')
  assert.deepEqual([r.code, r.err], [0, ''])
  assert.deepEqual(r.out.split('\n'), [
    'SURVIVED src/price.ts:2:45',
    "  > if (coupon === 'FIVEOFF') return Math.max(0, cents - 500)",
    '  with 0 changed to 1, no test failed',
    '  tests that run this code: 1. For the tests of the line: ubq covers src/price.ts:2',
    '',
    'mutate: 1 of 4 changes survived, 2 more are in code that no passing test runs (ubq uncovered)',
    '',
  ])
  assert.equal(mutate('src/price.ts:3'), 'mutate: 0 of 0 changes survived')
  assert.equal(readFileSync(join(p.dir, 'src/price.ts'), 'utf8'), SOURCE)
  // The check does not add runs to the store.
  assert.equal(p.ubq('failures').last, 'pass: 0 failed, 2 passed')

  // A test for the missing case, and the change does not survive.
  writeFileSync(join(p.dir, 'price.test.ts'), TEST + "test('not below zero', () => {\n  assert.equal(price(300, 'FIVEOFF'), 0)\n})\n")
  p.ubq('price.test.ts')
  assert.equal(mutate('src/price.ts'), 'mutate: 0 of 4 changes survived, 2 more are in code that no passing test runs (ubq uncovered)')

  // The stored lines must be the lines of the file.
  writeFileSync(join(p.dir, 'src/price.ts'), '\n' + SOURCE)
  assert.equal(p.ubq('mutate', 'src/price.ts').err, 'ubq: src/price.ts changed after the last run of its tests. Run them first: ubq --changed\n')
  assert.equal(p.ubq('mutate').code, 4)

  // On Bun, with its own load hook.
  if (spawnSync('bun', ['--version']).status === 0) {
    writeFileSync(join(p.dir, 'src/price.ts'), SOURCE)
    writeFileSync(join(p.dir, 'price.test.ts'), TEST)
    const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
    const bun = (...args: string[]) => spawnSync('bun', [cli, ...args], { cwd: p.dir, encoding: 'utf8' }).stdout
    bun('price.test.ts', 'pass.ts')
    assert.equal(bun('mutate', 'src/price.ts').split('\n').at(-2), 'mutate: 1 of 4 changes survived, 2 more are in code that no passing test runs (ubq uncovered)')
  }
})
