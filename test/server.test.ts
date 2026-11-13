// The background server: `ubq server`.
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, env, test } from 'ubqtest'
import { cli, project, remove } from './setup.ts'

// The server has a socket file. Windows has none.

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

test('a run with the server gives the same text, with test processes of the server', { timeout: 120_000 }, async () => {
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
    remove(p.dir)
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
  // An event for content that has an entry does not count. The
  // watcher of macOS can give more than one event for one change.
  const word = readFileSync(join(p.dir, 'src/word.ts'), 'utf8')
  writeFileSync(join(p.dir, 'src/word.ts'), word)
  appendFileSync(join(p.dir, 'src/greet.ts'), '// a change\n')
  for (let i = 0; i < 100 && status().prepared < 2; i++) await sleep(20)
  await sleep(200)
  assert.equal(status().prepared, 2)
  // A test process uses the entry that the server made.
  assert.equal(run('fail.ts', 'mock.ts', 'pass.ts'), alone)

  // A second server cannot listen, and ends.
  const second = p.ubq('server', '--foreground')
  assert.deepEqual([second.code, /^ubq server: listen EADDRINUSE/.test(second.err)], [4, true])

  assert.equal(p.ubq('server', 'stop').out, 'server: stopped\n')
  for (let i = 0; i < 100 && existsSync(join(p.dir, '.ubq/server.sock')); i++) await sleep(20)
  assert.equal(existsSync(join(p.dir, '.ubq/server.sock')), false)
  assert.equal(p.ubq('server', 'nope').code, 4)
  assert.equal(pid > 0, true)
})

test('a server that died does not stop a run', { timeout: 120_000 }, async () => {
  const p = project()
  cleanup(() => remove(p.dir))
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

test('the output of a test comes through the server, and a different runtime stops it', { timeout: 120_000 }, () => {
  const p = project()
  cleanup(() => {
    p.ubq('server', 'stop')
    remove(p.dir)
  })
  writeFileSync(
    join(p.dir, 'out.test.ts'),
    "import { spawnSync } from 'node:child_process'\nimport { assert, test } from 'ubqtest'\ntest('o', () => {\n  console.log('to stdout')\n  console.error('to stderr')\n  // A child process writes to the streams of the process.\n  spawnSync(process.execPath, ['-e', 'console.log(1); console.error(2)'], { stdio: 'inherit' })\n  assert.equal(1, 2)\n})\n",
  )
  p.ubq('server')
  const out = p.ubq('out.test.ts', 'pass.ts').out
  assert.match(out, /^  \| to stdout\n  \| to stderr$/m)
  // The test processes of the server loaded the code of a different
  // runtime. The server stops, and the run starts its own processes.
  const bun = spawnSync('bun', [cli, 'out.test.ts', 'pass.ts'], { cwd: p.dir, encoding: 'utf8', env: { ...process.env, CI: '' } })
  assert.match(bun.stdout, /^fail: 1 failed, 5 passed, 1 skipped/m)
  assert.equal(p.ubq('server', 'stop').out, 'server: not running\n')
})

test('a socket path that is too long', { skip: process.platform === 'win32' && 'Windows has a named pipe' }, () => {
  const p = project()
  cleanup(() => remove(p.dir))
  // From a deep folder, the path to the socket is long.
  const deep = join(p.dir, ...Array(35).fill('a'))
  mkdirSync(deep, { recursive: true })
  const r = spawnSync('node', [cli, 'server'], { cwd: deep, encoding: 'utf8' })
  assert.deepEqual([r.status, r.stderr], [4, `ubq: the path of the project is too long for a socket: ${join(p.dir, '.ubq/server.sock')}\n`])
})
