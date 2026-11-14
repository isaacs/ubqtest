// Less common paths of the runner: an early end of a file, a store
// that does not open, many changed files, and a signal.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { assert, cleanup, test } from 'ubqtest'
import { cli, project } from './setup.ts'

const SKIP = "import { test } from 'ubqtest'\ntest('s', { skip: 'x' }, () => {})\n"
const PASS = "import { assert, test } from 'ubqtest'\ntest('p', () => assert(true))\n"

test('a lone file that loads ubqtest, then throws or exits', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  writeFileSync(
    join(p.dir, 'throws.test.ts'),
    "import { test } from 'ubqtest'\ntest('t', () => {})\nthrow new Error('at load')\n",
  )
  const throws = p.ubq('throws.test.ts')
  assert.deepEqual([throws.code, throws.out.split('\n').slice(0, 2)], [1, ['ERROR throws.test.ts', '  Error: at load']])
  writeFileSync(join(p.dir, 'exits.test.ts'), "import { test } from 'ubqtest'\ntest('t', () => {})\nprocess.exit(5)\n")
  // With no import of ubqtest, the child process reports the exit.
  writeFileSync(join(p.dir, 'plain.test.ts'), 'process.exit()\n')
  assert.match(p.ubq('plain.test.ts').out, /^  the test process ended before the file did \(exit code 0\)$/m)
  const exits = p.ubq('exits.test.ts')
  assert.deepEqual(
    [exits.code, exits.out.split('\n').slice(0, 2)],
    [1, ['ERROR exits.test.ts', '  process.exit(5) was called before the tests ended']],
  )
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
  assert.match(
    early.out,
    /^ERROR b\.test\.ts\n  the test process ended before the file did \(exit code 3\)\n  a message\n/m,
  )
  // --failed runs all of a file with an error.
  writeFileSync(join(p.dir, 'b.test.ts'), PASS)
  assert.equal(p.ubq('--failed').last, 'pass: 0 failed, 1 passed')
})

test('--seed with no number, and many changed files', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  assert.deepEqual(
    [p.ubq('--seed').code, p.ubq('--seed').err],
    [4, 'ubq: --seed needs the number from a run, such as: ubq --seed 1234\n'],
  )
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
  for (const { name } of db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[])
    db.exec(`delete from ${name}`)
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

for (const [signal, exit] of [
  ['SIGTERM', 143],
  ['SIGINT', 130],
] as const)
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

test('a package.json that is not JSON', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  writeFileSync(join(p.dir, 'package.json'), '{')
  writeFileSync(join(p.dir, 'a.test.ts'), PASS)
  const r = p.ubq()
  assert.deepEqual([r.code, r.out.split('\n')[0]], [1, 'ERROR a.test.ts'])
})

test('--changed after a source file went away', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  writeFileSync(join(p.dir, 'src/gone.ts'), 'export const gone = 1\n')
  writeFileSync(
    join(p.dir, 'a.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { gone } from './src/gone.ts'\ntest('p', () => assert(gone))\n",
  )
  assert.equal(p.ubq('a.test.ts').code, 0)
  rmSync(join(p.dir, 'src/gone.ts'))
  const r = p.ubq('--changed')
  assert.deepEqual([r.code, r.out.split('\n').slice(0, 2)], [1, ['changed: src/gone.ts', 'ERROR a.test.ts']])
})

test('after 20 failure blocks, a run names the count of the others', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  const body = Array.from({ length: 23 }, (_, i) => `test('t${i}', () => assert.equal(${i}, -1))`).join('\n')
  writeFileSync(join(p.dir, 'many.test.ts'), `import { assert, test } from 'ubqtest'\n${body}\n`)
  const r = p.ubq('many.test.ts')
  const blocks = r.out.match(/^FAIL /gm) ?? []
  assert.deepEqual([r.code, blocks.length], [1, 20])
  // The project is new, so this is run 1.
  assert.match(r.out, /^and 3 more failures\. For all of them: ubq failures 1$/m)
  // `ubq failures` shows all of them.
  assert.equal(p.ubq('failures').out.match(/^FAIL /gm)?.length, 23)
  // In CI, nothing is cut.
  const ci = spawnSync('node', [cli, 'many.test.ts'], {
    cwd: p.dir,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  })
  assert.equal(ci.stdout.match(/^FAIL /gm)?.length, 23)
  // With no store, there is no run to name.
  const lost = project()
  cleanup(() => rmSync(lost.dir, { recursive: true, force: true }))
  mkdirSync(join(lost.dir, '.ubq/runs.db'), { recursive: true })
  writeFileSync(join(lost.dir, 'many.test.ts'), `import { assert, test } from 'ubqtest'\n${body}\n`)
  assert.match(lost.ubq('many.test.ts').out, /^and 3 more failures\.$/m)
})

test('--max-time stops the run, and names each file that did not end', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  assert.deepEqual(
    [p.ubq('--max-time', 'soon').code, p.ubq('--max-time').err],
    [4, 'ubq: --max-time needs a time in milliseconds, such as: ubq --max-time 60000\n'],
  )
  // More slow files than processes at one time, so that some
  // files do not start. Each slow test starts a child process.
  const slow = `import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { assert, test } from 'ubqtest'
test('waits', { timeout: 60_000 }, async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' })
  appendFileSync('pids.txt', child.pid + '\\n')
  await new Promise(r => setTimeout(r, 30_000))
  assert(true)
})
`
  const count = availableParallelism() + 1
  for (let i = 0; i < count; i++) writeFileSync(join(p.dir, `s${i}.test.ts`), slow)
  const t0 = Date.now()
  const r = p.ubq('--max-time', '2000', ...Array.from({ length: count }, (_, i) => `s${i}.test.ts`))
  assert.equal(r.code, 1)
  assert(Date.now() - t0 < 20_000, 'the run ended soon after the limit')
  assert.match(
    r.out,
    /^ERROR s\d+\.test\.ts\n  the run reached its time limit \(--max-time 2000 ms\), and stopped this file, in test: s\d+\.test\.ts > waits$/m,
  )
  assert.match(
    r.out,
    /^ERROR s\d+\.test\.ts\n  the run reached its time limit \(--max-time 2000 ms\) before this file started$/m,
  )
  assert.match(r.last!, new RegExp(`^fail: ${count} errors, 0 failed, 0 passed`))
  // The processes that the tests started are gone.
  const pids = readFileSync(join(p.dir, 'pids.txt'), 'utf8').trim().split('\n').map(Number)
  const alive = pids.filter(pid => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })
  assert.deepEqual(alive, [])
  // A file that is still at its top level has no test to name.
  writeFileSync(join(p.dir, 'load.test.ts'), 'await new Promise(r => setTimeout(r, 30_000))\n')
  assert.match(
    p.ubq('--max-time', '1000', 'load.test.ts').out,
    /^ERROR load\.test\.ts\n  the run reached its time limit \(--max-time 1000 ms\), and stopped this file$/m,
  )
})

test('show and failures name the variables of the environment that changed since the run before', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  const { TZ: _tz, NODE_ENV: _node, ...base } = process.env
  const ubq = (env: Record<string, string>, ...args: string[]) =>
    spawnSync('node', [cli, ...args], { cwd: p.dir, encoding: 'utf8', env: { ...base, CI: '', ...env } }).stdout
  ubq({ NODE_ENV: 'test' }, 'fail.ts')
  ubq({ TZ: 'UTC' }, 'fail.ts')
  const line = 'environment: NODE_ENV not set, TZ=UTC. In run 1: NODE_ENV=test, TZ not set'
  const failures = ubq({}, 'failures').trimEnd().split('\n')
  assert.equal(failures.at(-2), line)
  const id = /^FAIL (.*)$/m.exec(failures.join('\n'))?.[1] ?? ''
  assert.match(ubq({}, 'show', id), new RegExp(`^  ${line}$`, 'm'))
  // The same environment: no line.
  ubq({ TZ: 'UTC' }, 'fail.ts')
  assert(!ubq({}, 'failures').includes('environment'))
})

test('a run with code that no test ran names the command that lists it', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  mkdirSync(join(p.dir, 'src'), { recursive: true })
  writeFileSync(
    join(p.dir, 'src/sign.ts'),
    'export const sign = (n: number) => {\n  if (n < 0) return -1\n  return 1\n}\n',
  )
  writeFileSync(
    join(p.dir, 'a.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { sign } from './src/sign.ts'\ntest('one', () => assert.equal(sign(2), 1))\n",
  )
  const r = p.ubq('a.test.ts')
  // The exit code does not change, and the summary stays last.
  assert.equal(r.code, 0)
  assert.deepEqual(r.out.trimEnd().split('\n').slice(-2), [
    'note: 1 range of code in the files of this run ran in no test. To list it: ubq uncovered',
    'pass: 0 failed, 1 passed (run 1)',
  ])
  // With full coverage, there is no note.
  writeFileSync(
    join(p.dir, 'b.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { sign } from './src/sign.ts'\ntest('two', () => assert.equal(sign(-2), -1))\n",
  )
  const all = p.ubq('a.test.ts', 'b.test.ts')
  assert.equal(all.code, 0)
  assert(!all.out.includes('note:'), all.out)
  // The note leaves out build files and test helpers, as
  // `ubq uncovered` does.
  p.configure({ helpers: ['lib/**'], build: ['src/**'] })
  writeFileSync(join(p.dir, 'c.test.ts'), PASS)
  assert(!p.ubq('a.test.ts', 'c.test.ts').out.includes('note:'))
})

test('the store keeps the rows of the last 50 runs', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  writeFileSync(join(p.dir, 'a.test.ts'), PASS)
  p.ubq('a.test.ts')
  // Rows of run 1 in each table that has a run, and a later run 100.
  const db = new DatabaseSync(join(p.dir, '.ubq/runs.db'))
  db.exec(`insert into run (id, time, command, cwd, runtime, platform, ci, env) values (100, 0, '[]', '', '', '', 0, '{}');
    insert into type_error (run, error) values (1, '{}');
    insert into file_error (run, file, failure) values (1, 'a.test.ts', '{}');
    insert into output (run, file, stream, text) values (1, 'a.test.ts', 'stdout', 'x');`)
  db.close()
  // Run 101 removes the rows of runs 1 to 51.
  p.ubq('a.test.ts')
  const after = new DatabaseSync(join(p.dir, '.ubq/runs.db'), { readOnly: true })
  cleanup(() => after.close())
  const left = ['run', 'test', 'type_error', 'file_error', 'output'].map(
    t =>
      (after.prepare(`select count(*) as n from ${t} where ${t === 'run' ? 'id' : 'run'} = 1`).get() as { n: number })
        .n,
  )
  assert.deepEqual(left, [0, 0, 0, 0, 0])
})
