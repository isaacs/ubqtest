// Test files run as plain programs on each runtime.
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { assert, cleanup, test } from 'ubqtest'
import { fixtures, project } from './setup.ts'

// A project of its own: test files run in parallel, and they must
// not share a run store that one of them removes.
const dir = project().dir + '/'
cleanup(() => rmSync(dir, { recursive: true }))
const runtimes: [string, string[]][] = [
  ['node', []],
  ['deno', ['run', '-A']],
  ['bun', []],
]
const cases: [file: string, code: number, summary: string][] = [
  ['pass', 0, 'pass: 0 failed, 5 passed, 1 skipped'],
  ['fail', 1, 'fail: 15 failed, 0 passed'],
  ['empty', 2, 'fail: 0 failed, 0 passed'],
  ['load-error', 1, 'fail: 1 errors, 0 failed, 1 passed'],
  ['mock', 1, 'fail: 2 failed, 2 passed'],
]

for (const [cmd, args] of runtimes) {
  const found = spawnSync(cmd, ['--version']).status === 0
  for (const [file, code, summary] of cases) {
    test(`${cmd} ${file}`, { skip: !found && `${cmd} is not installed` }, () => {
      const r = spawnSync(cmd, [...args, `${file}.ts`], { cwd: dir, encoding: 'utf8' })
      assert.equal(r.stderr, '')
      assert.equal(r.status, code)
      // The run number changes with each run.
      const stdout = r.stdout.replace(/ \(run \d+\)\n$/, '\n')
      assert.equal(stdout.trimEnd().split('\n').at(-1), summary)
      // Node and Deno print values the same way. Bun differs in one
      // location, so only the summary and the exit code are checked.
      if (cmd !== 'bun')
        assert.equal(stdout, readFileSync(`${fixtures}${file}.out`, 'utf8'))
    })
  }
}

test('a closed stdout does not hang the process', () => {
  const r = spawnSync('sh', ['-c', 'node fail.ts | head -2'], { cwd: dir, encoding: 'utf8', timeout: 10000 })
  assert.equal(r.status, 0)
  assert.equal(r.stdout.split('\n').length, 3)
})
