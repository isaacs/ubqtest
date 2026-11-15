// Runs the extension in a real VS Code, on a project with a stored
// run. The checks in VS Code are in `suite.cjs`.
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { runTests } from '@vscode/test-electron'
import { cli, project } from '../../test/setup.ts'

const p = project()
try {
  // A project with ubq in node_modules/.bin, and a stored run.
  mkdirSync(join(p.dir, 'node_modules', '.bin'), { recursive: true })
  const bin = join(p.dir, 'node_modules', '.bin', 'ubq')
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`)
  chmodSync(bin, 0o755)
  writeFileSync(
    join(p.dir, 'src/sign.ts'),
    'export const sign = (n: number) => {\n  if (n < 0) return -1\n  return 1\n}\n',
  )
  writeFileSync(
    join(p.dir, 'a.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { sign } from './src/sign.ts'\ntest('positive', () => assert.equal(sign(2), 1))\n",
  )
  assert.equal(p.ubq('a.test.ts').code, 0)

  await runTests({
    extensionDevelopmentPath: fileURLToPath(new URL('..', import.meta.url)),
    extensionTestsPath: fileURLToPath(new URL('suite.cjs', import.meta.url)),
    launchArgs: [p.dir, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
  })

  // The command "ubq: Run the tests that ran this line" made a second
  // run, of the one test.
  const db = new DatabaseSync(join(p.dir, '.ubq', 'runs.db'), { readOnly: true })
  const runs = db.prepare('select pass, fail from run order by id').all()
  db.close()
  assert.deepEqual(
    runs.map(r => [r.pass, r.fail]),
    [
      [1, 0],
      [1, 0],
    ],
  )
  console.log('ok: the extension shows the store, runs the tests of a line, and goes to the tests')
} finally {
  rmSync(p.dir, { recursive: true, force: true })
}
