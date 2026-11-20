// Per-test coverage, the store, and the queries.
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { fileURLToPath } from 'node:url'
import { fixtures, project, remove } from './setup.ts'

const cwd = `${fixtures}cov/`
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const run = (cmd: string, ...args: string[]) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' })
  return { code: r.status, out: r.stdout.trimEnd().split('\n'), err: r.stderr }
}
const ubq = (...args: string[]) => run('node', cli, ...args)
// The library loaded its copies before coverage started. These
// copies have coverage.
const { originalColumn }: typeof import('../src/counters.ts') = await import('../src/counters.ts?copy' as string)
const { addCoverage, flatten, mergeRanges }: typeof import('../src/coverage.ts') = await import(
  '../src/coverage.ts?copy' as string
)
const reset = () => rmSync(`${cwd}.ubq`, { recursive: true, force: true })

test('flatten gives the count of the innermost range', () => {
  const r = (startOffset: number, endOffset: number, count: number) => ({ startOffset, endOffset, count })
  assert.deepEqual(
    flatten([{ ranges: [r(0, 100, 1)] }, { ranges: [r(10, 40, 2), r(20, 30, 0)] }, { ranges: [r(50, 60, 0)] }]),
    [0, 10, 1, 10, 20, 2, 20, 30, 0, 30, 40, 2, 40, 50, 1, 50, 60, 0, 60, 100, 1],
  )
  assert.deepEqual(flatten([{ ranges: [r(5, 9, 1)] }, { ranges: [r(20, 30, 3)] }]), [5, 9, 1, 20, 30, 3])
  // Of two ranges with one start, the shorter is inside.
  assert.deepEqual(flatten([{ ranges: [r(0, 5, 0)] }, { ranges: [r(0, 10, 1)] }]), [0, 5, 0, 5, 10, 1])
})

test('addCoverage adds the counts of a file that is in the list', () => {
  const files = [{ file: 'a.ts', ranges: [0, 5, 1] }]
  addCoverage(files, [
    { file: 'a.ts', ranges: [0, 5, 1] },
    { file: 'b.ts', ranges: [0, 1, 1] },
  ])
  assert.deepEqual(files, [
    { file: 'a.ts', ranges: [0, 5, 2] },
    { file: 'b.ts', ranges: [0, 1, 1] },
  ])
})

test('mergeRanges keeps a gap between two ranges', () => {
  assert.deepEqual(mergeRanges([0, 2, 1], [5, 6, 1]), [0, 2, 1, 5, 6, 1])
})

test('a column in the text of a counter is the place where the counter went', () => {
  // 5 characters went in before column 3 of the source.
  const shifts = [2, 5]
  assert.deepEqual([originalColumn(shifts, 2), originalColumn(shifts, 4), originalColumn(shifts, 9)], [2, 3, 4])
})

test('a run with preload has full coverage', () => {
  reset()
  const r = run('node', '--import', 'ubqtest/preload', 'test/calc.test.ts')
  assert.deepEqual(r, { code: 0, out: ['pass: 0 failed, 5 passed (run 1)'], err: '' })
  assert.deepEqual(ubq('uncovered').out, [
    "src/calc.ts:8:3  return 'fail'",
    'src/calc.ts:12:17  (): string => { (+2 lines)',
    "src/calc.ts:15:22  : () => 'other'",
    'src/calc.ts:18:8  function never(): number { (+3 lines)',
    '4 uncovered ranges in 1 of the 1 file that tests ran',
  ])
})

test('covers names the tests that ran a line', () => {
  assert.deepEqual(ubq('covers', 'src/calc.ts:1').out, [
    'test/calc.test.ts > add',
    // The load of the module makes the arrow function on line 1.
    'test/calc.test.ts (while the file loads)',
  ])
  assert.deepEqual(ubq('covers', 'src/calc.ts:5').out, ['test/calc.test.ts > grade A'])
  assert.deepEqual(ubq('covers', 'src/calc.ts:7').out, ['test/calc.test.ts > grade pass'])
  assert.deepEqual(ubq('covers', 'src/calc.ts:8').out, ['no test ran src/calc.ts:8'])
  assert.deepEqual(ubq('covers', 'src/calc.ts:23').out, ['test/calc.test.ts (while the file loads)'])
})

test('show, failures, and sql read the store', () => {
  assert.deepEqual(ubq('show', 'test/calc.test.ts > grade A').out.slice(0, 1), ['pass test/calc.test.ts > grade A'])
  assert.deepEqual(ubq('failures'), { code: 0, out: ['pass: 0 failed, 5 passed (run 1)'], err: '' })
  assert.deepEqual(ubq('sql', 'select status, count(*) n from test group by status').out, ['{"status":"pass","n":5}'])
})

test('a new run of a test replaces its coverage', () => {
  run('node', '--import', 'ubqtest/preload', 'test/calc.test.ts')
  assert.deepEqual(ubq('covers', 'src/calc.ts:1').out, [
    'test/calc.test.ts > add',
    // The load of the module makes the arrow function on line 1.
    'test/calc.test.ts (while the file loads)',
  ])
  assert.deepEqual(ubq('sql', 'select count(distinct run) n from coverage').out, ['{"n":1}'])
})

test('a plain run states that coverage can be incomplete', () => {
  run('node', 'test/calc.test.ts')
  assert.match(
    ubq('uncovered').out.at(-1)!,
    /^note: coverage is not complete for 1 test file: test\/calc\.test\.ts \(partial\)/,
  )
})

test('command errors exit with code 4', () => {
  assert.equal(ubq('covers', 'src/calc.ts').code, 4)
  assert.equal(ubq('nope').code, 4)
  assert.equal(ubq('show', 'no such test').code, 4)
  reset()
  assert.deepEqual(ubq('failures'), {
    code: 4,
    out: [''],
    err: 'ubq: no run. Run: ubq\n',
  })
})

test('uncovered leaves out test helpers, and its exit code is 1 for code that no test runs', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  mkdirSync(join(p.dir, 'test'))
  mkdirSync(join(p.dir, 'lib'))
  writeFileSync(
    join(p.dir, 'lib/add.ts'),
    "export const add = (a: number, b: number): number => a + b\nexport const never = (): number => 0\nexport const sep = (): string => (process.platform === 'none' ? '?' : '/')\n",
  )
  // A tool of the build, with a function that no test calls.
  mkdirSync(join(p.dir, 'scripts'))
  writeFileSync(
    join(p.dir, 'scripts/tool.ts'),
    "export const tool = (): string => 'tool'\nexport const unused = (): string => 'no'\n",
  )
  // A helper with a function that no test calls.
  writeFileSync(
    join(p.dir, 'test/scenario.ts'),
    "export const start = (): string => 'on'\nexport const unused = (): string => 'off'\n",
  )
  writeFileSync(
    join(p.dir, 'test/add.test.ts'),
    `import { assert, test } from 'ubqtest'
import { add, sep } from '../lib/add.ts'
import { tool } from '../scripts/tool.ts'
import { start } from './scenario.ts'

test('adds', () => {
  assert.deepEqual([start(), add(1, 2), sep(), tool()], ['on', 3, '/', 'tool'])
})
`,
  )
  const uncovered = (...args: string[]) => {
    const r = p.ubq('uncovered', ...args)
    return [r.code, r.out.trimEnd().split('\n')]
  }
  assert.equal(p.ubq().last, 'pass: 0 failed, 1 passed')
  assert.deepEqual(uncovered(), [
    1,
    [
      'lib/add.ts:2:22  (): number => 0',
      "lib/add.ts:3:63  ? '?'",
      '2 uncovered ranges in 1 of the 1 file that tests ran (1 test helper and 1 build file are not in this list: test/scenario.ts, scripts/tool.ts)',
      'note: 1 of these ranges is on a line that names a runtime or a system (process.platform, Bun, Deno). A run on one runtime and one system cannot run each of them. Run the tests in each environment, and merge the stores: see "Code for more than one runtime or system" in: ubq guide',
    ],
  ])
  // A file that the command names is in the list.
  assert.deepEqual(uncovered('test/scenario.ts'), [
    1,
    ["test/scenario.ts:2:23  (): string => 'off'", '1 uncovered range in test/scenario.ts'],
  ])
  // The `helpers` key replaces the folder names.
  p.configure({ helpers: [], build: [] })
  assert.equal(
    p.ubq('uncovered').out.trimEnd().split('\n').at(-2),
    '4 uncovered ranges in 3 of the 3 files that tests ran',
  )
  p.configure({ helpers: ['test/**', 'lib/**'], build: ['scripts/**'] })
  assert.deepEqual(uncovered(), [0, ['uncovered: none']])
})

test('a "ubq: not measured:" comment with a reason takes a range out of the list', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  mkdirSync(join(p.dir, 'lib'))
  writeFileSync(
    join(p.dir, 'lib/parts.ts'),
    `export const parts = (n: number): string => {
  if (n > 100) {
    // ubq: not measured: no caller gives more than 100
    return 'many'
  }
  if (n < 0) return 'none' /* ubq: not measured: the type is a count */
  if (n === 7) {
    // ubq: not measured:
    return 'seven'
  }
  return 'some'
}
`,
  )
  writeFileSync(
    join(p.dir, 'parts.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { parts } from './lib/parts.ts'\ntest('some', () => assert.equal(parts(3), 'some'))\n",
  )
  p.ubq('parts.test.ts')
  // The comment with no reason does not count.
  const r = p.ubq('uncovered')
  assert.deepEqual(
    [r.code, r.out.trimEnd().split('\n')],
    [
      1,
      [
        'lib/parts.ts:7:16  { (+3 lines)',
        '1 uncovered range in 1 of the 1 file that tests ran',
        '2 ranges with a "ubq: not measured:" comment are not in this list',
      ],
    ],
  )
  // A change after the run: the stored places are not the places of
  // the file now.
  appendFileSync(join(p.dir, 'lib/parts.ts'), '// a change\n')
  const changed = p.ubq('uncovered')
  assert.deepEqual(
    [changed.code, changed.out.split('\n')[0]],
    [1, 'lib/parts.ts  changed after the last run of its tests. Run them first: ubq --changed'],
  )
})

test('code in .ubq, the folder of ubq state and of builds for tests, is not coverage', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  mkdirSync(join(p.dir, '.ubq/build'), { recursive: true })
  writeFileSync(join(p.dir, '.ubq/build/one.js'), 'export const one = () => 1\n')
  writeFileSync(join(p.dir, 'two.ts'), 'export const two = () => 2\n')
  writeFileSync(
    join(p.dir, 'a.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { one } from './.ubq/build/one.js'\nimport { two } from './two.ts'\ntest('a', () => assert.equal(one() + two(), 3))\n",
  )
  assert.equal(p.ubq('a.test.ts').code, 0)
  assert.deepEqual(
    p.ubq('sql', 'select distinct file from coverage order by file').out,
    '{"file":"a.test.ts"}\n{"file":"two.ts"}\n',
  )
})

test('the coverage of a test file that is gone is not coverage', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  writeFileSync(join(p.dir, 'lib.ts'), 'export const one = () => 1\nexport const two = () => 2\n')
  const file = (name: string, call: string) =>
    writeFileSync(
      join(p.dir, name),
      `import { assert, test } from 'ubqtest'\nimport { one, two } from './lib.ts'\ntest('t', () => assert.equal(${call}, ${call}))\n`,
    )
  file('a.test.ts', 'one()')
  file('b.test.ts', 'two()')
  assert.equal(p.ubq().code, 0)
  rmSync(join(p.dir, 'b.test.ts'))
  assert.equal(p.ubq('a.test.ts').code, 0)
  assert.match(p.ubq('uncovered').out, /^lib\.ts:2:\d+ /m)
  assert.deepEqual(p.ubq('sql', 'select distinct tfile from coverage').out, '{"tfile":"a.test.ts"}\n')
})

test('"coverage": "full" fails a run of all tests with code that no test ran', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  p.configure({ coverage: 'full' })
  mkdirSync(join(p.dir, 'lib'))
  writeFileSync(
    join(p.dir, 'lib/add.ts'),
    'export const add = (a: number, b: number): number => a + b\nexport const never = (): number => {\n  return 0\n}\nexport const zero = (): number => 0\n',
  )
  const body = (name: string) =>
    `import { assert, test } from 'ubqtest'\nimport { add } from './lib/add.ts'\ntest('${name}', () => assert.equal(add(1, 2), 3))\n`
  writeFileSync(join(p.dir, 'a.test.ts'), body('a'))
  const lines = (...args: string[]) => {
    const r = p.ubq(...args)
    return [
      r.code,
      r.out
        .replace(/ \(run \d+[^)]*\)/, '')
        .trimEnd()
        .split('\n'),
    ]
  }
  const failed = (passed: number) => [
    1,
    [
      // A short list is in the output.
      '2 ranges of code ran in no test, and the configuration has "coverage": "full":',
      '  lib/add.ts:2:22  (): number => { (+2 lines)',
      '  lib/add.ts:5:21  (): number => 0',
      `fail: 0 failed, ${passed} passed, 2 uncovered ranges`,
    ],
  ]
  // One test file runs in the process of the command.
  assert.deepEqual(lines(), failed(1))
  // A run of a selection does not check.
  assert.deepEqual(lines('a.test.ts'), [0, ['pass: 0 failed, 1 passed']])
  // Each test file in its own process.
  writeFileSync(join(p.dir, 'b.test.ts'), body('b'))
  assert.deepEqual(lines(), failed(2))
  // A list of 5 or more is only in ubq uncovered.
  writeFileSync(
    join(p.dir, 'lib/add.ts'),
    'export const add = (a: number, b: number): number => a + b\n' +
      [1, 2, 3, 4, 5].map(n => `export const never${n} = (): number => ${n}\n`).join(''),
  )
  assert.deepEqual(lines(), [
    1,
    [
      '5 ranges of code ran in no test, and the configuration has "coverage": "full". See them: ubq uncovered',
      'fail: 0 failed, 2 passed, 5 uncovered ranges',
    ],
  ])
  // A range with a "not measured" comment is not a failure.
  writeFileSync(
    join(p.dir, 'lib/add.ts'),
    'export const add = (a: number, b: number): number => a + b\n// ubq: not measured: no caller yet\nexport const never = (): number => 0\n',
  )
  assert.deepEqual(lines(), [0, ['pass: 0 failed, 2 passed']])
  // The value must be "full".
  p.configure({ coverage: true })
  assert.equal(p.ubq().err, 'ubq: "ubq.coverage" in package.json must be "full"\n')
})
