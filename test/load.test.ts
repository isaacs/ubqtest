// A test file that does not load: a syntax error, or an import of a
// file that does not exist.
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { project } from './setup.ts'

test('a test file that does not load is an error of the file, with the place', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(join(p.dir, 'bad.ts'), "import { test } from 'ubqtest'\ntest('x', () => {\n  const a = (\n})\n")
  writeFileSync(join(p.dir, 'missing.ts'), "import { test } from 'ubqtest'\nimport './nope.ts'\ntest('x', () => {})\n")
  const blocks = (...args: string[]) => {
    const r = p.ubq(...args)
    return [r.code, ...r.out.replace(/ \(run \d+\)\n$/, '').split('\n').filter(l => l && !l.startsWith('file order:'))]
  }
  const bad = [
    'ERROR bad.ts',
    '  the test file did not load: Expression expected',
    '  at bad.ts:4:1',
    '  > })',
  ]
  const missing = [
    'ERROR missing.ts',
    "  the test file did not load: Cannot find module 'nope.ts' imported from missing.ts",
  ]
  // One file runs in the process of the runner.
  assert.deepEqual(blocks('bad.ts'), [1, ...bad, 'fail: 1 errors, 0 failed, 0 passed'])
  assert.deepEqual(blocks('missing.ts'), [1, ...missing, 'fail: 1 errors, 0 failed, 0 passed'])
  // In a child process.
  assert.deepEqual(blocks('--seed', '1', 'bad.ts', 'missing.ts', 'pass.ts').sort(), [
    1,
    ...bad,
    ...missing,
    'skip pass.ts > not on this platform: needs a GPU',
    'fail: 2 errors, 0 failed, 5 passed, 1 skipped',
  ].sort())
  // The store has the errors.
  const again = p.ubq('failures').out.split('\n')
  assert.deepEqual(again.slice(again.indexOf(bad[0]!), again.indexOf(bad[0]!) + 4), bad)
})
