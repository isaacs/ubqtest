// Type checks next to the tests, in each run of a TypeScript project.
import { existsSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { project } from './setup.ts'

const modules = fileURLToPath(new URL('../node_modules/', import.meta.url))

test('a run reports the type errors of the project', () => {
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

  writeFileSync(
    join(p.dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { module: 'nodenext', target: 'esnext', strict: true, noEmit: true, allowImportingTsExtensions: true, types: ['node'] },
      include: ['typed.test.ts'],
    }),
  )
  for (const name of ['typescript', '@types']) symlinkSync(join(modules, name), join(p.dir, 'node_modules', name), 'junction')
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
  // The store has the type errors of the run.
  const again = p.ubq('failures')
  assert.deepEqual([again.code, again.out.includes('\nTYPE typed.test.ts\n'), again.last], [1, true, 'fail: 1 failed, 0 passed, 2 type errors'])
  // A run of a selection checks the types too. The second run reads
  // the data of the first one, and reports the same errors.
  assert(existsSync(join(p.dir, '.ubq', 'types', 'tsbuildinfo')))
  const one = p.ubq('pass.ts')
  assert.deepEqual([one.code, one.last], [1, 'fail: 0 failed, 5 passed, 1 skipped, 2 type errors'])
  const repeat = p.ubq('--repeat', '2', 'pass.ts')
  assert.deepEqual([repeat.code, repeat.out.includes('TS2322')], [1, true])
})
