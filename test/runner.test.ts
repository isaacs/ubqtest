// The runner: many files, selection, exit codes, and dead processes.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, test } from 'ubqtest'
import { fixtures as cwd } from './setup.ts'

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const ubq = (args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync('node', [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, CI: '', ...env } })
  // The run number changes with each run.
  return { code: r.status, out: r.stdout.replace(/ \(run \d+\)\n$/, '\n').trimEnd().split('\n'), err: r.stderr }
}

test('one file runs in the CLI process', () => {
  assert.deepEqual(ubq(['pass.ts']), {
    code: 0,
    out: ['skip pass.ts > not on this platform: needs a GPU', 'pass: 0 failed, 5 passed, 1 skipped'],
    err: '',
  })
})

test('a line selects the test that contains it', () => {
  assert.deepEqual(ubq(['pass.ts:14']).out, ['pass: 0 failed, 1 passed, 5 not selected'])
  assert.deepEqual(ubq(['pass.ts:14', 'pass.ts:26']).out, ['pass: 0 failed, 2 passed, 4 not selected'])
})

test('a line before all tests selects nothing, exit code 2', () => {
  const r = ubq(['pass.ts:2'])
  assert.equal(r.code, 2)
  assert.deepEqual(r.out.slice(0, 2), ['ERROR pass.ts', '  no test starts at or before line 2 of this file'])
})

test('many files run in child processes', () => {
  const r = ubq(['pass.ts', 'cov/test/calc.test.ts'])
  assert.deepEqual(r, {
    code: 0,
    out: ['skip pass.ts > not on this platform: needs a GPU', 'pass: 0 failed, 10 passed, 1 skipped'],
    err: '',
  })
})

test('failures and file errors give exit code 1', () => {
  const r = ubq(['pass.ts', 'load-error.ts', 'empty.ts'])
  assert.equal(r.code, 1)
  assert.equal(r.out.at(-1), 'fail: 2 errors, 0 failed, 6 passed, 1 skipped')
})

test('process.exit in a test is an error, not a silent end', () => {
  const plain = spawnSync('node', ['exit.ts'], { cwd, encoding: 'utf8' })
  assert.equal(plain.status, 1)
  assert.match(plain.stdout, /process\.exit\(0\) was called before the tests ended, in test: exit\.ts > calls process\.exit/)
  const r = ubq(['exit.ts', 'pass.ts'])
  assert.equal(r.code, 1)
  assert.equal(r.out.at(-1), 'fail: 1 errors, 0 failed, 6 passed, 1 skipped')
})

test('a process that dies is an error that names the test', () => {
  const r = ubq(['crash.ts', 'pass.ts'])
  assert.equal(r.code, 1)
  assert.deepEqual(r.out.slice(0, 2), [
    'ERROR crash.ts',
    '  the test process ended before the file did (SIGKILL), in test: crash.ts > dies',
  ])
})

test('no test files gives exit code 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ubq-empty-'))
  writeFileSync(join(dir, 'package.json'), '{}')
  const r = spawnSync('node', [cli], { cwd: dir, encoding: 'utf8' })
  rmSync(dir, { recursive: true })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /no test files/)
})

test('a file that does not exist gives exit code 4', () => {
  const r = ubq(['nope.ts'])
  assert.deepEqual([r.code, r.err], [4, 'ubq: no such file: nope.ts\n'])
})

test('in CI, the first line states the runtime and the command', () => {
  assert.match(ubq(['pass.ts'], { CI: '1' }).out[0]!, /^ubq: node \S+, \S+ \S+, ubq pass\.ts$/)
})

test('a failed test shows its own console output, a passed test shows none', () => {
  const r = ubq(['output.ts'])
  assert.equal(r.err, '')
  assert.deepEqual(r.out, [
    'FAIL output.ts > fails and prints',
    '  expected values to be equal',
    '  at output.ts:14:10',
    '  > assert.equal(1 as number, 2)',
    '  actual:   1',
    '  expected: 2',
    '  output:',
    '  | step 1: start',
    '  | step 2: about to fail',
    '  rerun: ubq output.ts:10',
    '',
    'fail: 1 failed, 1 passed',
  ])
  assert.deepEqual(ubq(['show', 'output.ts > fails and prints']).out.slice(-4, -1), [
    '  output:',
    '  | step 1: start',
    '  | step 2: about to fail',
  ])
  assert.deepEqual(ubq(['sql', "select text from output where test is null and text like 'printed%'"]).out, [
    '{"text":"printed while the file loads\\n"}',
  ])
})

test('a plain program keeps its console', () => {
  const r = spawnSync('node', ['output.ts'], { cwd, encoding: 'utf8' })
  assert.deepEqual(r.stdout.split('\n').slice(0, 3), [
    'printed while the file loads',
    'from a test that passes',
    'step 1: start',
  ])
  assert.equal(r.stderr, 'step 2: about to fail\n')
})

test('hangs: a promise that never settles, a timeout, a process that stays alive', () => {
  const t0 = performance.now()
  const r = ubq(['hang.ts'])
  // The test that never settles must not wait for its 5000 ms limit.
  assert(performance.now() - t0 < 4000, 'the run took too long')
  assert.equal(r.code, 1)
  const text = r.out.join('\n')
  assert.match(text, /FAIL hang\.ts > never settles, nothing pending\n  the promise of the test never settled/)
  assert.match(text, /the test did not end in 50 ms\n.*\n.*\n  still open: TCPServerWrap/)
  assert.match(text, /ERROR hang\.ts\n  the tests ended, but the process did not exit\..*\n  still open: TCPServerWrap/)
  assert.equal(r.out.at(-1), 'fail: 1 errors, 2 failed, 1 passed')
})

test('a loop that does not return is stopped, with the line of the loop', () => {
  for (const args of [['busy.ts'], ['busy.ts', 'pass.ts']]) {
    const r = ubq(args)
    assert.deepEqual(r.out.slice(0, 5), [
      'FAIL busy.ts > loops forever',
      '  the test did not end in 100 ms, and the process does not respond. The code is in a loop that does not return.',
      '  at busy.ts:5:3',
      '  > while (true) x += n',
      '  at busy.ts:13:16',
    ])
    assert.match(r.out.join('\n'), /ERROR busy\.ts\n  ubq stopped the process\. The tests after the stuck test did not run\./)
  }
  assert.equal(ubq(['busy.ts', 'pass.ts']).out.at(-1), 'fail: 1 errors, 1 failed, 6 passed, 1 skipped')
})

test('processes that a test file leaves behind are stopped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ubq-orphan-'))
  const pidFile = join(dir, 'pid')
  const r = ubq(['orphan.ts', 'pass.ts'], { ORPHAN_PID_FILE: pidFile })
  assert.equal(r.code, 0)
  const pid = +readFileSync(pidFile, 'utf8')
  rmSync(dir, { recursive: true })
  // Signal 0 tests for the process and sends nothing.
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})
