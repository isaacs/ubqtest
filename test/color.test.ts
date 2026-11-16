// Color for a person at a terminal (D75): red for a fail, cyan for a
// pass. Not in CI, with NO_COLOR or FORCE_COLOR=0, and not when
// stdout is not a terminal.
import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
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
  // stdout is a pipe: the preload makes it look like a terminal. On
  // Node: Bun and Deno do not load a preload from NODE_OPTIONS.
  const tty = join(p.dir, 'tty.mjs')
  writeFileSync(tty, 'process.stdout.isTTY = true\n')
  const ubq = (env: NodeJS.ProcessEnv, ...args: string[]) =>
    spawnSync('node', [cli, ...args], {
      cwd: p.dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: '',
        NO_COLOR: '',
        FORCE_COLOR: '',
        NODE_OPTIONS: `--import=${pathToFileURL(tty).href}`,
        ...env,
      },
    }).stdout
  return { ...p, ubq }
}

test('at a terminal, FAIL and fail are red, and pass is cyan', () => {
  const p = setup()
  const out = p.ubq({}, 'a.test.ts', 'b.test.ts')
  assert.match(out, new RegExp(`^${RED('FAIL').replaceAll('[', '\\[')} a\\.test\\.ts > bad$`, 'm'))
  assert.match(
    out,
    new RegExp(`^${RED('fail').replaceAll('[', '\\[')}: 1 failed, 2 passed, 1 skipped \\(run 1\\)$`, 'm'),
  )
  assert.equal(p.ubq({}, 'failures').split('\n').at(-2), `${RED('fail')}: 1 failed, 2 passed, 1 skipped (run 1)`)
  assert.equal(p.ubq({}, 'show', 'a.test.ts > good').split('\n')[0], `${CYAN('pass')} a.test.ts > good`)
  // A skip has no color.
  assert.equal(p.ubq({}, 'show', 'b.test.ts > later').split('\n')[0], 'skip b.test.ts > later')
  assert.match(p.ubq({}, 'history', 'a.test.ts > bad'), new RegExp(`  ${RED('fail').replaceAll('[', '\\[')}  `))
  assert.equal(p.ubq({}, 'check').split('\n').at(-2), `${RED('fail')}: 1 failed tests`)
  assert.equal(p.ubq({}, 'b.test.ts').split('\n').at(-2), `${CYAN('pass')}: 0 failed, 1 passed, 1 skipped (run 2)`)
})

const esc = (text: string) => text.replaceAll('[', '\\[')

test('at a terminal, ERROR and SURVIVED are red, and so are the failures of ubq diff', () => {
  const p = setup()
  p.ubq({}, 'a.test.ts')
  writeFileSync(join(p.dir, 'c.test.ts'), "import { test } from 'ubqtest'\nthrow new Error('boom')\n")
  writeFileSync(
    join(p.dir, 'a.test.ts'),
    "import { assert, test } from 'ubqtest'\ntest('bad', () => assert.equal(1, 1))\n",
  )
  assert.match(p.ubq({}, 'a.test.ts', 'c.test.ts'), new RegExp(`^${esc(RED('ERROR'))} c\\.test\\.ts$`, 'm'))
  const diff = p.ubq({}, 'diff', '1', '2')
  assert.match(diff, new RegExp(`^${esc(RED('ERROR'))} c\\.test\\.ts \\(no error in run 1\\)$`, 'm'))
  assert.match(diff, new RegExp(`^${esc(CYAN('pass'))} a\\.test\\.ts > bad \\(was fail in run 1\\)$`, 'm'))

  rmSync(join(p.dir, 'c.test.ts'))
  writeFileSync(join(p.dir, 'two.ts'), 'export const two = (): number => 1 + 1\n')
  writeFileSync(
    join(p.dir, 'a.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { two } from './two.ts'\ntest('two', () => assert.equal(typeof two(), 'number'))\n",
  )
  p.ubq({}, 'a.test.ts')
  assert.match(p.ubq({}, 'mutate', 'two.ts'), new RegExp(`^${esc(RED('SURVIVED'))} two\\.ts:1:`, 'm'))
})

test('in CI, with NO_COLOR, or with FORCE_COLOR=0, there is no color', () => {
  const p = setup()
  assert(!p.ubq({ CI: '1' }, 'a.test.ts', 'b.test.ts').includes('\x1b['))
  assert(!p.ubq({ CI: '1' }, 'check').includes('\x1b['))
  assert(!p.ubq({ NO_COLOR: '1' }, 'failures').includes('\x1b['))
  assert(!p.ubq({ FORCE_COLOR: '0' }, 'failures').includes('\x1b['))
  // FORCE_COLOR with a different value does not stop the color.
  assert(p.ubq({ FORCE_COLOR: '1' }, 'failures').includes('\x1b['))
})
