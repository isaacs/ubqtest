// `ubq status`: the runs in progress, the files that run, and the
// test that runs in each file.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { cli, project, remove } from './setup.ts'

// The file waits for `load` while it loads, and its test waits for
// `go`.
const SLOW = `import { existsSync } from 'node:fs'
import { assert, test } from 'ubqtest'
const wait = async (name: string) => {
  while (!existsSync(new URL(name, import.meta.url))) await new Promise(resolve => setTimeout(resolve, 20))
}
await wait('load')
test('waits', async () => {
  await wait('go')
  assert.equal(1, 1)
})
`

const status = (dir: string): string[] =>
  spawnSync(process.execPath, [cli, 'status'], { cwd: dir, encoding: 'utf8' }).stdout.split('\n').slice(0, -1)

/** The lines of `ubq status` when `match` accepts them, with each time as `N s`. */
const until = async (dir: string, match: (lines: string[]) => boolean): Promise<string[]> => {
  const limit = Date.now() + 15_000
  for (;;) {
    const lines = status(dir).map(l => l.replace(/\d+\.\d s/g, 'N s'))
    if (match(lines)) return lines
    if (Date.now() > limit) throw new Error(`no such status. Last: ${JSON.stringify(lines)}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

test('ubq status names the files that run, and the test that runs in each', async () => {
  const p = project()
  cleanup(() => remove(p.dir))
  writeFileSync(join(p.dir, 'slow.test.ts'), SLOW)
  writeFileSync(
    join(p.dir, 'fast.test.ts'),
    "import { assert, test } from 'ubqtest'\ntest('quick', () => assert.equal(1, 1))\ntest('later', { skip: 'not now' }, () => {})\n",
  )
  writeFileSync(join(p.dir, 'bad.test.ts'), "import { test } from 'ubqtest'\nthrow new Error('boom')\n")
  assert.deepEqual(status(p.dir), ['no run in progress'])

  const child = spawn(process.execPath, [cli, 'slow.test.ts', 'fast.test.ts', 'bad.test.ts'], {
    cwd: p.dir,
    env: { ...process.env, CI: '' },
  })
  cleanup(() => void child.kill())
  const done = new Promise(resolve => child.on('close', resolve))
  const head = `run 1: ubq slow.test.ts fast.test.ts bad.test.ts (pid ${child.pid}, N s)`
  const ended = '2 of 3 files ended: 1 errors, 0 failed, 1 passed, 1 skipped'
  // The file loads.
  assert.deepEqual(await until(p.dir, l => l[1] === ended), [head, ended, 'slow.test.ts, N s'])
  // Its test runs.
  writeFileSync(join(p.dir, 'load'), '')
  assert.deepEqual(await until(p.dir, l => l.length === 3 && l[2] !== 'slow.test.ts, N s'), [
    head,
    ended,
    'slow.test.ts, N s: slow.test.ts > waits, N s',
  ])
  writeFileSync(join(p.dir, 'go'), '')
  assert.equal(await done, 1)
  assert.deepEqual(status(p.dir), ['no run in progress'])
  assert.deepEqual(readdirSync(join(p.dir, '.ubq', 'now')), [])
})

test('ubq status shows a run of one file', async () => {
  const p = project()
  cleanup(() => remove(p.dir))
  writeFileSync(join(p.dir, 'slow.test.ts'), SLOW)
  writeFileSync(join(p.dir, 'load'), '')
  const child = spawn(process.execPath, [cli, 'slow.test.ts'], { cwd: p.dir, env: { ...process.env, CI: '' } })
  cleanup(() => void child.kill())
  const done = new Promise(resolve => child.on('close', resolve))
  const lines = await until(p.dir, l => l.length === 3 && l[2] !== 'slow.test.ts, N s')
  assert.match(lines[0]!, /^run 1: ubq slow\.test\.ts \(pid \d+, N s\)$/)
  assert.deepEqual(lines.slice(1), [
    '0 of 1 file ended: 0 failed, 0 passed',
    'slow.test.ts, N s: slow.test.ts > waits, N s',
  ])
  writeFileSync(join(p.dir, 'go'), '')
  assert.equal(await done, 0)
  assert.deepEqual(status(p.dir), ['no run in progress'])
})

test('ubq status: runs whose process is gone, in the order of their numbers', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  const { pid } = spawnSync(process.execPath, ['-e', ''])
  mkdirSync(join(p.dir, '.ubq', 'now'), { recursive: true })
  for (const run of [10, 9])
    writeFileSync(
      join(p.dir, '.ubq', 'now', `${run}.json`),
      JSON.stringify({
        run,
        pid,
        time: 0,
        command: ['ubq'],
        files: 1,
        ended: 0,
        pass: 0,
        fail: 0,
        skip: 0,
        errors: 0,
        running: {},
      }),
    )
  assert.deepEqual(status(p.dir), [
    `run 9 stopped before its end: its process (${pid}) is gone`,
    `run 10 stopped before its end: its process (${pid}) is gone`,
  ])
  assert.deepEqual(status(p.dir), ['no run in progress'])
})
