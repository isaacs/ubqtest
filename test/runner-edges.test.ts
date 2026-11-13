// Less common paths of the runner: an early end of a file, a store
// that does not open, many changed files, and a signal.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { assert, cleanup, test } from 'ubqtest'
import { cli, project } from './setup.ts'

const SKIP = "import { test } from 'ubqtest'\ntest('s', { skip: 'x' }, () => {})\n"
const PASS = "import { assert, test } from 'ubqtest'\ntest('p', () => assert(true))\n"

test('a lone file that loads ubqtest, then throws or exits', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  writeFileSync(join(p.dir, 'throws.test.ts'), "import { test } from 'ubqtest'\ntest('t', () => {})\nthrow new Error('at load')\n")
  const throws = p.ubq('throws.test.ts')
  assert.deepEqual([throws.code, throws.out.split('\n').slice(0, 2)], [1, ['ERROR throws.test.ts', '  Error: at load']])
  writeFileSync(join(p.dir, 'exits.test.ts'), "import { test } from 'ubqtest'\ntest('t', () => {})\nprocess.exit(5)\n")
  // With no import of ubqtest, the child process reports the exit.
  writeFileSync(join(p.dir, 'plain.test.ts'), 'process.exit()\n')
  assert.match(p.ubq('plain.test.ts').out, /^  the test process ended before the file did \(exit code 0\)$/m)
  const exits = p.ubq('exits.test.ts')
  assert.deepEqual([exits.code, exits.out.split('\n').slice(0, 2)], [1, ['ERROR exits.test.ts', '  process.exit(5) was called before the tests ended']])
})

test('a run of files with only skipped tests, and an early end with stderr', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  writeFileSync(join(p.dir, 'a.test.ts'), SKIP)
  writeFileSync(join(p.dir, 'b.test.ts'), SKIP)
  const skipped = p.ubq('a.test.ts', 'b.test.ts')
  assert.deepEqual([skipped.code, skipped.last], [2, 'fail: 0 failed, 0 passed, 2 skipped'])
  writeFileSync(join(p.dir, 'b.test.ts'), "console.error('a message')\nprocess.exit(3)\n")
  const early = p.ubq('a.test.ts', 'b.test.ts')
  assert.match(early.out, /^ERROR b\.test\.ts\n  the test process ended before the file did \(exit code 3\)\n  a message\n/m)
  // --failed runs all of a file with an error.
  writeFileSync(join(p.dir, 'b.test.ts'), PASS)
  assert.equal(p.ubq('--failed').last, 'pass: 0 failed, 1 passed')
})

test('--seed with no number, and many changed files', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  assert.deepEqual([p.ubq('--seed').code, p.ubq('--seed').err], [4, 'ubq: --seed needs the number from a run, such as: ubq --seed 1234\n'])
  assert.equal(p.ubq('pass.ts').code, 0)
  for (let i = 0; i < 12; i++) writeFileSync(join(p.dir, `n${String(i).padStart(2, '0')}.test.ts`), SKIP)
  assert.equal(
    p.ubq('--changed').out.split('\n')[0],
    'changed: n00.test.ts, n01.test.ts, n02.test.ts, n03.test.ts, n04.test.ts, n05.test.ts, n06.test.ts, n07.test.ts, n08.test.ts, n09.test.ts, and 2 more',
  )
})

test('a store that does not open', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  mkdirSync(join(p.dir, '.ubq/runs.db'), { recursive: true })
  writeFileSync(join(p.dir, 'a.test.ts'), PASS)
  writeFileSync(join(p.dir, 'b.test.ts'), PASS)
  const r = p.ubq('a.test.ts', 'b.test.ts')
  assert.equal(r.code, 0)
  assert.match(r.out, /^note: this run is not stored: /m)
  // A plain run of a test file.
  const plain = spawnSync('node', ['a.test.ts'], { cwd: p.dir, encoding: 'utf8', env: { ...process.env, CI: '' } })
  assert.equal(plain.status, 0)
  assert.match(plain.stdout, /^note: this run is not stored: /m)
})

test('the commands that read a run, with a store that has no runs', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  writeFileSync(join(p.dir, 'a.test.ts'), PASS)
  p.ubq('a.test.ts')
  const db = new DatabaseSync(join(p.dir, '.ubq/runs.db'))
  db.exec('pragma foreign_keys = off')
  for (const { name } of db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]) db.exec(`delete from ${name}`)
  db.close()
  const errors = ['failures', 'slow', 'diff', 'diff 5'].map(c => p.ubq(...c.split(' '))).map(r => [r.code, r.err])
  assert.deepEqual(errors, [
    [4, 'ubq: run (last) is not in the store\n'],
    [4, 'ubq: run (last) is not in the store\n'],
    [4, 'ubq: ubq diff needs two runs, and the store has no runs\n'],
    [4, 'ubq: run 5 is not in the store: the store has no runs\n'],
  ])
})

test('a write of bytes, with an encoding and a callback', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  writeFileSync(
    join(p.dir, 'a.test.ts'),
    "import { assert, test } from 'ubqtest'\ntest('t', async () => {\n  await new Promise(done => process.stdout.write(Buffer.from('bytes\\n'), 'utf8', done))\n  assert(false)\n})\n",
  )
  writeFileSync(join(p.dir, 'b.test.ts'), PASS)
  assert.match(p.ubq('a.test.ts', 'b.test.ts').out, /^  \| bytes$/m)
})

test('a store of a different version starts again', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  writeFileSync(join(p.dir, 'a.test.ts'), PASS)
  p.ubq('a.test.ts')
  assert.match(p.ubq('a.test.ts').out, / \(run 2\)\n$/)
  const db = new DatabaseSync(join(p.dir, '.ubq/runs.db'))
  db.exec('pragma user_version = 1')
  db.close()
  assert.match(p.ubq('a.test.ts').out, / \(run 1\)\n$/)
})

for (const [signal, exit] of [['SIGTERM', 143], ['SIGINT', 130]] as const)
  test(`${signal} ends the run`, { skip: process.platform === 'win32' && 'no signals on Windows' }, async () => {
    const p = project()
    cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
    writeFileSync(
      join(p.dir, 'a.test.ts'),
      "import { writeFileSync } from 'node:fs'\nimport { test } from 'ubqtest'\ntest('waits', () => {\n  writeFileSync('started', '')\n  return new Promise(r => setTimeout(r, 10_000))\n})\n",
    )
    writeFileSync(join(p.dir, 'b.test.ts'), SKIP)
    const child = spawn('node', [cli, 'a.test.ts', 'b.test.ts'], { cwd: p.dir, env: { ...process.env, CI: '' } })
    const closed = new Promise(r => child.on('close', r))
    while (!existsSync(join(p.dir, 'started'))) await new Promise(r => setTimeout(r, 20))
    // Deno gives `close` no exit code after `child.kill()`.
    process.kill(child.pid!, signal)
    assert.equal(await closed, exit)
    // The store has the run, with no end.
    const failures = p.ubq('failures')
    assert.deepEqual([failures.code, failures.out.trimEnd().split('\n').at(-1)], [1, 'run 1 did not end'])
    writeFileSync(join(p.dir, 'a.test.ts'), PASS)
    p.ubq('a.test.ts')
    assert.equal(p.ubq('diff').out.trimEnd().split('\n').at(-1), 'note: run 1 did not end')
  })
