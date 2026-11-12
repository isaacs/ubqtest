// Type checks next to the tests: a run of all tests, and `--types`.
import { rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { project } from './setup.ts'

const modules = fileURLToPath(new URL('../node_modules/', import.meta.url))

test('a run of all tests reports the type errors of the project', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(
    join(p.dir, 'typed.test.ts'),
    `import { assert, test } from 'ubqtest'
const count: number = 'one'
test('passes at run time', () => {
  assert.ok(count)
})
`,
  )
  // No tsconfig.json: no type check.
  assert.deepEqual([p.ubq().code, p.ubq().last], [1, 'fail: 1 failed, 0 passed'])
  const none = p.ubq('--types', 'pass.ts')
  assert.deepEqual([none.code, none.err], [4, 'ubq: --types needs tsconfig.json in the project root, and the typescript package: npm install --save-dev typescript\n'])

  writeFileSync(
    join(p.dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { module: 'nodenext', target: 'esnext', strict: true, noEmit: true, allowImportingTsExtensions: true, types: ['node'] },
      include: ['typed.test.ts'],
    }),
  )
  for (const name of ['typescript', '@types']) symlinkSync(join(modules, name), join(p.dir, 'node_modules', name))
  const all = p.ubq()
  assert.equal(all.code, 1)
  assert.deepEqual(all.out.replace(/ \(run \d+\)\n$/, '').split('\n').slice(-12), [
    'TYPE typed.test.ts',
    "  TS2322: Type 'string' is not assignable to type 'number'.",
    '  at typed.test.ts:2:7',
    "  > const count: number = 'one'",
    '',
    'TYPE typed.test.ts',
    '  TS2349: This expression is not callable.',
    `Type 'Hint<"Use assert(value)">' has no call signatures.`.padStart(58),
    '  at typed.test.ts:4:10',
    '  > assert.ok(count)',
    '',
    'fail: 1 failed, 0 passed, 2 type errors',
  ])
  // A run of a selection has no type check, but for `--types`.
  assert.deepEqual([p.ubq('pass.ts').code, p.ubq('pass.ts').last], [0, 'pass: 0 failed, 5 passed, 1 skipped'])
  const typed = p.ubq('--types', 'pass.ts')
  assert.deepEqual([typed.code, typed.last], [1, 'fail: 0 failed, 5 passed, 1 skipped, 2 type errors'])
})
