// The runner: many files, selection, exit codes, and dead processes.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  const r = ubq(['pass.ts', 'cov'])
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
