// The background server: `ubq server`.
import { appendFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, env, test } from 'ubqtest'
import { project } from './setup.ts'

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

test('a run with the server gives the same text, with test processes of the server', { timeout: 30_000 }, async () => {
  const p = project()
  const status = (): { pid: number; used: number; prepared: number } => {
    const m = /^server: pid (\d+), 8 test processes wait, (\d+) used, (\d+) changed files prepared\n/.exec(p.ubq('server').out)
    assert(m, 'the status line')
    return { pid: +m[1]!, used: +m[2]!, prepared: +m[3]! }
  }
  /** The text of a run, with no run number. */
  const run = (...files: string[]): string => {
    const r = p.ubq('--seed', '1', ...files)
    // The blocks of different files come in the order that the files end.
    const blocks = r.out.replace(/ \(run \d+\)\n$/, '\n').split('\n\n')
    return [...blocks.slice(0, -1).sort(), blocks.at(-1)].join('\n\n') + r.err + r.code
  }
  cleanup(() => {
    p.ubq('server', 'stop')
    rmSync(p.dir, { recursive: true })
  })
  assert.equal(p.ubq('server', 'stop').out, 'server: not running\n')
  const alone = run('fail.ts', 'mock.ts', 'pass.ts')

  const started = p.ubq('server')
  assert.equal(started.out.split('\n')[1], 'It stops after 30 minutes with no use, or with: ubq server stop')
  const { pid } = status()
  assert.equal(run('fail.ts', 'mock.ts', 'pass.ts'), alone)
  assert.equal(status().used, 3)

  // A different environment: the processes of the server did not
  // start with it, so the runner starts its own, and the server
  // starts new ones with that environment.
  env({ FIX_B: 'b' })
  const fix = run('fix.ts', 'pass.ts')
  assert.match(fix, /fail: \d failed, \d+ passed, 1 skipped\n1$/)
  // The first file of that run got no process of the server.
  const used = status().used
  assert.equal(used < 5, true)
  assert.equal(run('fix.ts', 'pass.ts'), fix)
  assert.equal(status().used, used + 2)

  // The server makes the counters of a file that changes.
  appendFileSync(join(p.dir, 'src/word.ts'), '// a change\n')
  for (let i = 0; i < 100 && !status().prepared; i++) await sleep(20)
  assert.equal(status().prepared, 1)

  assert.equal(p.ubq('server', 'stop').out, 'server: stopped\n')
  for (let i = 0; i < 100 && existsSync(join(p.dir, '.ubq/server.sock')); i++) await sleep(20)
  assert.equal(existsSync(join(p.dir, '.ubq/server.sock')), false)
  assert.equal(p.ubq('server', 'nope').code, 4)
  assert.equal(pid > 0, true)
})

test('a server that died does not stop a run', { timeout: 30_000 }, async () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  const pid = +/pid (\d+)/.exec(p.ubq('server').out)![1]!
  process.kill(pid, 'SIGKILL')
  await sleep(100)
  // The socket file is there, and nothing answers.
  assert.equal(existsSync(join(p.dir, '.ubq/server.sock')), true)
  assert.equal(p.ubq('mock.ts', 'pass.ts').last, 'fail: 2 failed, 7 passed, 1 skipped')
  // A new server takes the place of the dead one.
  assert.match(p.ubq('server').out, /^server: pid \d+, 8 test processes wait, 0 used/)
  assert.equal(p.ubq('server', 'stop').out, 'server: stopped\n')
})
