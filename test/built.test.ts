// A test that loads a built file with a source map has coverage of
// the source files (D55).
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSync } from 'esbuild'
import { assert, cleanup, test } from 'ubqtest'
import { project } from './setup.ts'

const make = () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  mkdirSync(join(p.dir, 'lib'))
  writeFileSync(
    join(p.dir, 'lib/index.ts'),
    `import { double } from './math.ts'

export const greet = (name: string): string => {
  if (name === 'x') {
    return 'no'
  }
  return \`hello \${name} \${double(2)}\`
}

export const never = (): number => 0
`,
  )
  // The bundler removes `half`: nothing uses it.
  writeFileSync(
    join(p.dir, 'lib/math.ts'),
    'export const double = (n: number): number => n * 2\nexport const half = (n: number): number => {\n  return n / 2\n}\n',
  )
  writeFileSync(
    join(p.dir, 'out.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { greet } from './dist/out.js'\ntest('greets', () => {\n  assert.equal(greet('a'), 'hello a 4')\n})\n",
  )
  const build = (minify: boolean): void => {
    buildSync({
      absWorkingDir: p.dir,
      entryPoints: ['lib/index.ts'],
      bundle: true,
      format: 'esm',
      sourcemap: true,
      minify,
      outfile: 'dist/out.js',
      logLevel: 'silent',
    })
  }
  const uncovered = (): string[] => p.ubq('uncovered').out.trimEnd().split('\n')
  return { ...p, build, uncovered }
}

const LIST = [
  'lib/index.ts:4:21  { (+2 lines)',
  'lib/index.ts:10:22  (): number => 0',
  'lib/math.ts:2:21  (n: number): number => { (+2 lines)',
  '3 uncovered ranges in 2 of the 2 files that tests ran',
]

for (const minify of [false, true])
  test(`the coverage of a bundle is coverage of its source files${minify ? ', also with minify' : ''}`, { timeout: 30_000 }, () => {
    const p = make()
    p.build(minify)
    assert.equal(p.ubq().last, 'pass: 0 failed, 1 passed')
    // The list has the code that the bundler removed. The built file is not in it.
    assert.deepEqual(p.uncovered(), LIST)
    assert.deepEqual(p.ubq('covers', 'lib/math.ts:1').out.trimEnd().split('\n').at(-1), '1 tests run lib/math.ts:1')
  })

test('a source that changed after the build has no coverage until the next build', { timeout: 30_000 }, () => {
  const p = make()
  p.build(false)
  appendFileSync(join(p.dir, 'lib/math.ts'), '// a change\n')
  assert.equal(p.ubq().last, 'pass: 0 failed, 1 passed')
  assert.deepEqual(p.uncovered(), [
    'lib/index.ts:4:21  { (+2 lines)',
    'lib/index.ts:10:22  (): number => 0',
    '2 uncovered ranges in 1 of the 1 files that tests ran',
    'note: coverage is not complete for 1 test files: out.test.ts (partial). Code can be missing from this list. For full coverage, run the file with ubq: ubq <test file>',
  ])
  p.build(false)
  assert.equal(p.ubq().last, 'pass: 0 failed, 1 passed')
  assert.deepEqual(p.uncovered(), LIST)
})
