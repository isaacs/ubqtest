// Color for a person at a terminal (D75): red for a fail, cyan for a
// pass. Not in CI, and not when stdout is not a terminal.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { cli, project, remove } from './setup.ts'

const RED = (text: string) => `\x1b[40;31m${text}\x1b[m`
const CYAN = (text: string) => `\x1b[40;36m${text}\x1b[m`

const setup = () => {
  const p = project()
  cleanup(() => remove(p.dir))
  writeFileSync(
    join(p.dir, 'a.test.ts'),
    "import { assert, test } from 'ubqtest'\ntest('good', () => assert.equal(1, 1))\ntest('bad', () => assert.equal(1, 2))\n",
  )
  writeFileSync(
    join(p.dir, 'b.test.ts'),
    "import { assert, test } from 'ubqtest'\ntest('b', () => assert.equal(1, 1))\ntest('later', { skip: 'not yet' }, () => {})\n",
  )
  // stdout is a pipe: the preload makes it look like a terminal.
  const tty = join(p.dir, 'tty.mjs')
  writeFileSync(tty, 'process.stdout.isTTY = true\n')
  const ubq = (ci: string, ...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: p.dir,
      encoding: 'utf8',
      env: { ...process.env, CI: ci, NODE_OPTIONS: `--import=${pathToFileURL(tty).href}` },
    }).stdout
  return { ...p, ubq }
}

test('at a terminal, FAIL and fail are red, and pass is cyan', () => {
  const p = setup()
  const out = p.ubq('', 'a.test.ts', 'b.test.ts')
  assert.match(out, new RegExp(`^${RED('FAIL').replaceAll('[', '\\[')} a\\.test\\.ts > bad$`, 'm'))
  assert.match(
    out,
    new RegExp(`^${RED('fail').replaceAll('[', '\\[')}: 1 failed, 2 passed, 1 skipped \\(run 1\\)$`, 'm'),
  )
  assert.equal(p.ubq('', 'failures').split('\n').at(-2), `${RED('fail')}: 1 failed, 2 passed, 1 skipped (run 1)`)
  assert.equal(p.ubq('', 'show', 'a.test.ts > good').split('\n')[0], `${CYAN('pass')} a.test.ts > good`)
  // A skip has no color.
  assert.equal(p.ubq('', 'show', 'b.test.ts > later').split('\n')[0], 'skip b.test.ts > later')
  assert.match(p.ubq('', 'history', 'a.test.ts > bad'), new RegExp(`  ${RED('fail').replaceAll('[', '\\[')}  `))
  assert.equal(p.ubq('', 'check').split('\n').at(-2), `${RED('fail')}: 1 failed tests`)
  assert.equal(p.ubq('', 'b.test.ts').split('\n').at(-2), `${CYAN('pass')}: 0 failed, 1 passed, 1 skipped (run 2)`)
})

test('in CI, there is no color', () => {
  const p = setup()
  assert(!p.ubq('1', 'a.test.ts', 'b.test.ts').includes('\x1b['))
  assert(!p.ubq('1', 'check').includes('\x1b['))
})
