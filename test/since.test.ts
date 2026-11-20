// What changed since a failed test last passed: the lines that the
// test ran in its last pass, and that are different now (D69).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { DatabaseSync } from 'node:sqlite'
import { project, remove } from './setup.ts'

// The library loads the module before coverage starts: a copy has counts.
const { lineDiff }: typeof import('../src/since.ts') = await import('../src/since.ts?copy' as string)

test('lineDiff: the groups of lines that differ', () => {
  const l = (text: string): string[] => text.split('')
  assert.deepEqual(lineDiff(l('abc'), l('abc')), [])
  // A change, a new line, and a removed line.
  assert.deepEqual(lineDiff(l('abcde'), l('aXcde')), [[1, 2, 1, 2]])
  assert.deepEqual(lineDiff(l('abc'), l('abXc')), [[2, 2, 2, 3]])
  assert.deepEqual(lineDiff(l('abc'), l('ac')), [[1, 2, 1, 1]])
  // Two changes far apart are two groups.
  assert.deepEqual(lineDiff(l('abcdefg'), l('aXcdeYg')), [
    [1, 2, 1, 2],
    [5, 6, 5, 6],
  ])
  assert.deepEqual(lineDiff(l('abcdefg'), l('acdXefg')), [
    [1, 2, 1, 1],
    [4, 4, 3, 4],
  ])
  assert.deepEqual(lineDiff([], l('ab')), [[0, 0, 0, 2]])
  // A change too large for the table is one group.
  const big = Array.from({ length: 3000 }, (_, i) => `${i}`)
  const other = big.map(line => `${line}!`)
  assert.deepEqual(lineDiff(['x', ...big, 'y'], ['x', ...other, 'y']), [[1, 3001, 1, 3001]])
})

const SRC = `export const add = (a: number, b: number): number => {
  return a + b
}

export const sub = (a: number, b: number): number => a - b
`
const TEST = `import { assert, test } from 'ubqtest'
import { add, sub } from '../lib/math.ts'
test('add', () => assert.equal(add(1, 2), 3))
test('sub', () => assert.equal(sub(3, 1), 2))
`

const setup = () => {
  const p = project()
  cleanup(() => remove(p.dir))
  mkdirSync(join(p.dir, 'lib'))
  mkdirSync(join(p.dir, 'test'))
  writeFileSync(join(p.dir, 'lib/math.ts'), SRC)
  writeFileSync(join(p.dir, 'test/math.test.ts'), TEST)
  return { ...p, file: (name: string) => join(p.dir, name) }
}

test('a failure names the lines that it ran and that changed after its last pass', () => {
  const p = setup()
  assert.equal(p.ubq('test/math.test.ts').code, 0)
  // A change that the test runs, and one that no test runs.
  writeFileSync(p.file('lib/math.ts'), SRC.replace('return a + b', 'const c = a + b\n  return c + 1') + '\n// more\n')
  let r = p.ubq('test/math.test.ts')
  assert.equal(r.code, 1)
  assert.match(
    r.out,
    /^ {2}since run 1, where it passed, these lines that it runs changed: lib\/math\.ts:2-3\n {2}rerun: ubq test\/math\.test\.ts:3$/m,
  )
  // The same failure again keeps the run of the last pass.
  r = p.ubq('test/math.test.ts')
  assert.match(r.out, /^ {2}since run 1, where it passed, these lines that it runs changed: lib\/math\.ts:2-3$/m)
  assert.match(p.ubq('failures').out, /^ {2}since run 1, where it passed/m)
  assert.match(
    p.ubq('show', 'test/math.test.ts > add').out,
    /^ {2}since run 1, where it passed, these lines that it runs changed: lib\/math\.ts:2-3$/m,
  )
})

test('the run of many files names the changes too: removed lines, a removed file, and the test file', () => {
  const p = setup()
  writeFileSync(
    p.file('lib/sum.ts'),
    'export const sum = (a: number): number => {\n  let c = a\n  c += 1\n  return c\n}\n',
  )
  writeFileSync(p.file('lib/extra.ts'), 'export const one = (): number => 1\n')
  writeFileSync(
    p.file('test/other.test.ts'),
    `import { assert, test } from 'ubqtest'
import { sum } from '../lib/sum.ts'
test('sum', () => assert.equal(sum(1), 2))
test('one', async () => {
  const { one } = await import('../lib/extra.ts').catch(() => ({ one: () => 0 }))
  assert.equal(one(), 1)
})
`,
  )
  assert.equal(p.ubq().code, 0)
  writeFileSync(p.file('lib/sum.ts'), 'export const sum = (a: number): number => {\n  let c = a\n  return c\n}\n')
  writeFileSync(
    p.file('test/math.test.ts'),
    TEST.replace("test('sub', () => assert.equal(sub(3, 1), 2))", "test('sub', () => assert.equal(sub(3, 1), 3))"),
  )
  rmSync(p.file('lib/extra.ts'))
  const r = p.ubq()
  assert.equal(r.code, 1)
  const since = (id: string): string | undefined =>
    new RegExp(`^FAIL ${id}\n(?: {2}.*\n)*? {2}since (.*)$`, 'm').exec(r.out)?.[1]
  assert.equal(
    since('test/other.test.ts > sum'),
    'run 1, where it passed, these lines that it runs changed: lib/sum.ts:3 (lines removed)',
  )
  assert.equal(
    since('test/other.test.ts > one'),
    'run 1, where it passed, these lines that it runs changed: lib/extra.ts (removed)',
  )
  assert.equal(
    since('test/math.test.ts > sub'),
    'run 1, where it passed, these lines that it runs changed: test/math.test.ts:4',
  )
})

test('a failure with no change since the last pass, lines removed, and more than five places', () => {
  const p = setup()
  writeFileSync(
    p.file('test/flip.test.ts'),
    `import { readFileSync } from 'node:fs'
import { assert, test } from 'ubqtest'
test('flip', () => assert.equal(readFileSync(process.env.FLIP_FILE!, 'utf8'), 'ok'))
`,
  )
  p.set('ok')
  const many = Array.from({ length: 7 }, (_, i) => `export const f${i} = (): number => ${i}\n\n`).join('')
  writeFileSync(p.file('lib/many.ts'), many + 'export const g = (): number => {\n  const x = 1\n  return x\n}\n')
  writeFileSync(
    p.file('test/many.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport * as m from '../lib/many.ts'\ntest('all', () => assert.equal(m.f0() + m.f1() + m.f2() + m.f3() + m.f4() + m.f5() + m.f6() + m.g(), 22))\n",
  )
  assert.equal(p.ubq().code, 0)
  p.set('not ok')
  writeFileSync(
    p.file('lib/many.ts'),
    many.replace(/=> (\d)/g, '=> $1 + 1') + 'export const g = (): number => {\n  return 1\n}\n',
  )
  const r = p.ubq()
  assert.match(
    r.out,
    /^ {2}since run 1, where it passed, no code that it runs changed\. The cause is in its data or its environment, or it is flaky: ubq --repeat 10 'test\/flip\.test\.ts > flip'$/m,
  )
  assert.match(
    r.out,
    /^ {2}since run 1, where it passed, these lines that it runs changed: lib\/many\.ts:1, lib\/many\.ts:3, lib\/many\.ts:5, lib\/many\.ts:7, lib\/many\.ts:9, and 3 more$/m,
  )
  // A pass with a different version of ubq, then a failure.
  p.set('ok')
  assert.equal(p.ubq('test/flip.test.ts').code, 0)
  const db = new DatabaseSync(p.file('.ubq/runs.db'))
  db.exec(`update run set env = json_set(env, '$.ubq', '0.0.1') where id = 3`)
  db.close()
  p.set('not ok')
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  assert.match(
    p.ubq('test/flip.test.ts').out,
    new RegExp(
      `^  since run 3, where it passed, no code that it runs changed, and ubq changed from 0\\.0\\.1 to ${version.replaceAll('.', '\\.')}\\. The new version can be the cause$`,
      'm',
    ),
  )
  assert.match(
    p.ubq('failures').out,
    new RegExp(`^environment: ubq ${version.replaceAll('.', '\\.')}\\. In run 3: ubq 0\\.0\\.1$`, 'm'),
  )
})

test('no line for a failure with no pass before it, or with no stored coverage', () => {
  const p = setup()
  writeFileSync(p.file('test/math.test.ts'), TEST + "test('later', { skip: 'not yet' }, () => assert.equal(1, 2))\n")
  assert.equal(p.ubq('test/math.test.ts').code, 0)
  // A test that is new, a test that was skipped, and a pass with no coverage.
  writeFileSync(
    p.file('test/math.test.ts'),
    TEST.replace('sub(3, 1), 2', 'sub(3, 1), 0') +
      "test('later', () => assert.equal(1, 2))\ntest('new', () => assert.equal(1, 2))\n",
  )
  const db = new DatabaseSync(p.file('.ubq/runs.db'))
  db.exec("delete from coverage where test = 'test/math.test.ts > sub'")
  db.close()
  const r = p.ubq('test/math.test.ts')
  assert.equal(r.code, 1)
  assert.match(r.out, /^fail: 3 failed, 1 passed/m)
  assert(!r.out.includes('since run'))
})

test('a constant of a module that changed: the line ran while the test file loaded', () => {
  const p = setup()
  writeFileSync(p.file('lib/tuning.ts'), 'export const T = {\n  bonus: 0.15,\n}\n')
  writeFileSync(
    p.file('test/tuning.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { T } from '../lib/tuning.ts'\ntest('bonus', () => assert.equal(T.bonus, 0.15))\n",
  )
  assert.equal(p.ubq().code, 0)
  writeFileSync(p.file('lib/tuning.ts'), 'export const T = {\n  bonus: 0.16,\n}\n')
  assert.match(
    p.ubq().out,
    /^ {2}since run 1, where it passed, no line that it runs changed\. These lines that ran while its file loaded changed: lib\/tuning\.ts:2$/m,
  )
  // The same after the store wrote the start of the file, which
  // removes the rows of the load of the run before.
  writeFileSync(
    p.file('test/tuning.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { T } from '../lib/tuning.ts'\ntest('bonus', async () => {\n  await new Promise(resolve => setTimeout(resolve, 600))\n  assert.equal(T.bonus, 0.16)\n})\n",
  )
  assert.equal(p.ubq().code, 0)
  writeFileSync(p.file('lib/tuning.ts'), 'export const T = {\n  bonus: 0.17,\n}\n')
  assert.match(
    p.ubq().out,
    /^ {2}since run 3, where it passed, no line that it runs changed\. These lines that ran while its file loaded changed: lib\/tuning\.ts:2$/m,
  )
})
