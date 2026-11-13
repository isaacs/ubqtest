// `ubq mutate`: the mutation check.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { project } from './setup.ts'

// The load hook of the counters loads the parser with `require`,
// while this file loads. A static import of the same module from
// this file is an error in Node (a cycle of `require` and `import`).
// Deno cannot load this module with `require`.
const { mutants }: typeof import('../src/instrument.ts') =
  process.versions.deno ? await import('../src/instrument.ts') : createRequire(import.meta.url)('../src/instrument.ts')

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
`, 'a.ts')
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
  assert.equal(mutants('const = 1', 'a.ts'), undefined)
  assert.equal(mutants('const = 1', 'a.mjs'), undefined)
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
    const log = join(p.dir, 'mutate.log')
    const bun = (...args: string[]) =>
      spawnSync('bun', [cli, ...args], { cwd: p.dir, encoding: 'utf8', env: { ...process.env, UBQ_MUTATE_LOG: log } }).stdout
    bun('price.test.ts', 'pass.ts')
    const result = bun('mutate', 'src/price.ts')
    // TEMPORARY: the cause of a rare false kill in CI.
    const kills = (existsSync(log) ? readFileSync(log, 'utf8') : '').split('\n').filter(line => line.includes('"text":"1"'))
    assert.equal(result.split('\n').at(-2), 'mutate: 1 of 4 changes survived, 2 more are in code that no passing test runs (ubq uncovered)', kills.join('\n'))
  }
})

test('mutate with more than one file: the order of the report, a long line, a test that fails, and wrong arguments', { timeout: 60_000 }, () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  mkdirSync(join(p.dir, 'lib'))
  writeFileSync(
    join(p.dir, 'lib/a.ts'),
    `export const LIMIT = 10
export const over = (n: number): boolean => n > LIMIT
export const label = (n: number): string => (n === 0 ? 'none' : n === 1 ? 'one' : 'many') + ' items in the list of things that the function counts for the caller'
`,
  )
  writeFileSync(
    join(p.dir, 'lib/b.ts'),
    'export const twice = (n: number): number => n * 2\nexport const sign = (n: number): number => {\n  if (n < 0) return -1\n  return 1\n}\n',
  )
  // Assertions that pass for each change, and a test that fails with no change.
  writeFileSync(
    join(p.dir, 'm.test.ts'),
    `import { assert, test } from 'ubqtest'
import { label, over } from './lib/a.ts'
import { sign, twice } from './lib/b.ts'
test('weak', () => {
  assert.equal(typeof over(100), 'boolean')
  assert.match(label(5), /items/)
  assert.equal(typeof twice(2), 'number')
  assert(sign(5) > 0)
})
test('fails with no change', () => {
  assert.equal(sign(-5), 1)
})
`,
  )
  assert.equal(p.ubq('m.test.ts').last, 'fail: 1 failed, 1 passed')
  const lines = p.ubq('mutate', 'lib/b.ts', 'lib/a.ts').out.trimEnd().split('\n')
  // In the order of the files and of the places, not of the arguments.
  assert.deepEqual(
    lines.filter(line => line.startsWith('SURVIVED')),
    ['lib/a.ts:2:47', 'lib/a.ts:3:48', 'lib/a.ts:3:52', 'lib/a.ts:3:67', 'lib/a.ts:3:71', 'lib/b.ts:1:47', 'lib/b.ts:1:49', 'lib/b.ts:3:9', 'lib/b.ts:3:11'].map(
      place => `SURVIVED ${place}`,
    ),
  )
  // A source line of more than 100 characters is cut.
  assert.equal(lines[6], "  > export const label = (n: number): string => (n === 0 ? 'none' : n === 1 ? 'one' : 'many') + ' items …")
  assert.equal(lines.at(-1), 'mutate: 9 of 12 changes survived, 1 more are in code that no passing test runs (ubq uncovered)')
  assert.equal(p.ubq('mutate', 'lib/a.ts:99').out, 'mutate: 0 of 0 changes survived\n')
  assert.deepEqual([p.ubq('mutate', 'lib/nope.ts').code, p.ubq('mutate', 'lib/nope.ts').err], [4, 'ubq: no test loaded lib/nope.ts. Run the tests first: ubq\n'])
  const v8 = spawnSync('node', [fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'mutate', 'lib/a.ts'], {
    cwd: p.dir,
    encoding: 'utf8',
    env: { ...process.env, UBQ_COVERAGE: 'v8' },
  })
  assert.deepEqual([v8.status, v8.stderr], [4, 'ubq: ubq mutate needs source counters. Remove UBQ_COVERAGE=v8.\n'])
})

test('a change that removes a "!", in code that runs while the test file loads', { timeout: 30_000 }, () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  mkdirSync(join(p.dir, 'lib'))
  writeFileSync(join(p.dir, 'lib/c.ts'), 'export const ON = !false\n')
  writeFileSync(join(p.dir, 'c.test.ts'), "import { assert, test } from 'ubqtest'\nimport { ON } from './lib/c.ts'\ntest('t', () => assert(typeof ON === 'boolean'))\n")
  p.ubq('c.test.ts')
  assert.deepEqual(p.ubq('mutate', 'lib/c.ts').out.split('\n').slice(0, 4), [
    'SURVIVED lib/c.ts:1:19',
    '  > export const ON = !false',
    '  with ! changed to nothing, no test failed',
    '  tests that run this code: 1. For the tests of the line: ubq covers lib/c.ts:1',
  ])
})
