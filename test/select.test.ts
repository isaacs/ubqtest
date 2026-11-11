// Selection of tests: by ID, and by the result of the last run.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, test } from 'ubqtest'
import { fixtures } from './setup.ts'

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

/** A project of its own, so that its store has only the runs of one test. */
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ubq-select-'))
  writeFileSync(join(dir, 'package.json'), '{ "type": "module" }')
  for (const f of ['flip.ts', 'pass.ts', 'src']) cpSync(`${fixtures}${f}`, join(dir, f), { recursive: true })
  mkdirSync(join(dir, 'node_modules'))
  symlinkSync(fileURLToPath(new URL('..', import.meta.url)), join(dir, 'node_modules/ubqtest'))
  const flip = join(dir, 'flip.txt')
  const ubq = (...args: string[]) => {
    const r = spawnSync('node', [cli, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, CI: '', FLIP_FILE: flip } })
    return { code: r.status, last: r.stdout.replace(/ \(run \d+\)\n$/, '').split('\n').at(-1), err: r.stderr, out: r.stdout }
  }
  return { dir, ubq, set: (v: string) => writeFileSync(flip, v) }
}

test('a test ID selects one test, and a group ID selects its tests', () => {
  const p = project()
  p.set('pass')
  const one = p.ubq('flip.ts > c')
  assert.deepEqual([one.code, one.last, one.err], [0, 'pass: 0 failed, 1 passed, 2 not selected', ''])
  assert.equal(p.ubq('flip.ts > group').last, 'pass: 0 failed, 2 passed, 1 not selected')
  assert.equal(p.ubq('flip.ts > group > b', 'flip.ts > c').last, 'pass: 0 failed, 2 passed, 1 not selected')
  assert.equal(p.ubq('flip.ts > c', 'pass.ts').last, 'pass: 0 failed, 6 passed, 1 skipped, 2 not selected')
  const none = p.ubq('flip.ts > nope')
  assert.equal(none.code, 2)
  assert.match(none.out, /no test of this file has an ID in the selection\. The IDs in this file are:\n  flip\.ts > group > a\n/)
  assert.deepEqual([p.ubq('gone.ts > x').code, p.ubq('gone.ts > x').err], [4, 'ubq: no such file: gone.ts\n'])
  rmSync(p.dir, { recursive: true })
})

test('--failed runs the tests that failed in their last run', () => {
  const p = project()
  p.set('fail')
  assert.equal(p.ubq('flip.ts', 'pass.ts').last, 'fail: 1 failed, 7 passed, 1 skipped')
  // Only the failed test runs. It fails again.
  assert.equal(p.ubq('--failed').last, 'fail: 1 failed, 0 passed, 2 not selected')
  p.set('pass')
  assert.equal(p.ubq('--failed').last, 'pass: 0 failed, 1 passed, 2 not selected')
  // Now no test has a failure as its last result.
  assert.deepEqual([p.ubq('--failed').code, p.ubq('--failed').err], [2, 'ubq: no test failed in its last run\n'])
  assert.equal(p.ubq('--failed', 'flip.ts').code, 4)
  assert.equal(p.ubq('--nope').code, 4)
  rmSync(p.dir, { recursive: true })
})
