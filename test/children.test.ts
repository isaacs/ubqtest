// Coverage of the processes that a test starts (D53).
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { project } from './setup.ts'

const bun = spawnSync('bun', ['--version']).status === 0

/** A project with a command, a server, and tests that start them. */
const make = () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  mkdirSync(join(p.dir, 'lib'))
  mkdirSync(join(p.dir, 'test'))
  writeFileSync(
    join(p.dir, 'lib/cli.ts'),
    `import { greet } from './greet.ts'
const [name] = process.argv.slice(2)
if (!name) {
  console.error('usage: cli <name>')
  process.exit(2)
}
console.log(greet(name))
`,
  )
  writeFileSync(
    join(p.dir, 'lib/greet.ts'),
    "export const greet = (name: string): string => (name === 'x' ? 'no' : `hello ${name}`)\nexport const never = (): number => 0\n",
  )
  writeFileSync(
    join(p.dir, 'lib/server.ts'),
    `import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { greet } from './greet.ts'
const server = createServer((req, res) => {
  if (req.url === '/x') return res.end(greet('x'))
  res.end(greet('server'))
}).listen(0, () => console.log((server.address() as AddressInfo).port))
`,
  )
  return p
}
const lines = (text: string): string[] => text.trimEnd().split('\n')

test('the code of a child process is coverage of the test that started it', { timeout: 60_000 }, () => {
  const p = make()
  writeFileSync(
    join(p.dir, 'test/cli.test.ts'),
    `import { spawn, spawnSync } from 'node:child_process'
import { assert, cleanup, test } from 'ubqtest'

test('the command greets', () => {
  assert.equal(spawnSync('node', ['lib/cli.ts', 'a'], { encoding: 'utf8' }).stdout, 'hello a\\n')
})
test('a child with a new environment', () => {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }
  assert.equal(spawnSync('node', ['lib/cli.ts'], { env }).status, 2)
})
test('a server that the test stops', async () => {
  const child = spawn('node', ['lib/server.ts'], { stdio: ['ignore', 'pipe', 'inherit'] })
  cleanup(async () => {
    // Windows has no signal that a process can catch. The child
    // writes its counts on a timer.
    if (process.platform === 'win32') await new Promise(done => setTimeout(done, 500))
    await new Promise(done => child.on('close', done).kill())
  })
  const port = await new Promise(done => child.stdout.once('data', data => done(+String(data))))
  assert.equal(await (await fetch(\`http://localhost:\${port}/\`)).text(), 'hello server')
})
`,
  )
  assert.equal(p.ubq().last, 'pass: 0 failed, 3 passed')
  assert.deepEqual(lines(p.ubq('uncovered').out), [
    "lib/greet.ts:1:62  ? 'no'",
    'lib/greet.ts:2:22  (): number => 0',
    "lib/server.ts:5:25  return res.end(greet('x'))",
    '3 uncovered ranges in 2 of the 3 files that tests ran',
  ])
  assert.deepEqual(lines(p.ubq('covers', 'lib/cli.ts:4').out), ['test/cli.test.ts > a child with a new environment', '1 tests run lib/cli.ts:4'])
  assert.deepEqual(lines(p.ubq('covers', 'lib/cli.ts:7').out), [
    'test/cli.test.ts > a child with a new environment',
    'test/cli.test.ts > the command greets',
    '2 tests run lib/cli.ts:7',
  ])
  assert.deepEqual(lines(p.ubq('covers', 'lib/server.ts:6').out), ['test/cli.test.ts > a server that the test stops', '1 tests run lib/server.ts:6'])
  // A change to code that only a child runs selects the test of that child.
  writeFileSync(join(p.dir, 'lib/cli.ts'), `import { greet } from './greet.ts'
const [name] = process.argv.slice(2)
if (!name) {
  console.error('usage: cli <name>')
  process.exit(2)
}
console.log(greet(name) + '!')
`)
  assert.deepEqual(lines(p.ubq('--changed').out.replace(/ \(run \d+\)\n$/, '')).filter(line => /^(changed|FAIL|fail)/.test(line)), [
    'changed: lib/cli.ts',
    'FAIL test/cli.test.ts > the command greets',
    'fail: 1 failed, 1 passed, 1 not selected',
  ])
})

test('a child process on Bun has coverage too', { skip: !bun && 'bun is not installed', timeout: 60_000 }, () => {
  const p = make()
  writeFileSync(
    join(p.dir, 'test/bun.test.ts'),
    `import { spawnSync } from 'node:child_process'
import { assert, test } from 'ubqtest'

test('the command on bun', () => {
  assert.equal(spawnSync('bun', ['lib/cli.ts', 'x'], { encoding: 'utf8' }).stdout, 'no\\n')
})
`,
  )
  assert.equal(p.ubq().last, 'pass: 0 failed, 1 passed')
  assert.deepEqual(lines(p.ubq('covers', 'lib/cli.ts:7').out), ['test/bun.test.ts > the command on bun', '1 tests run lib/cli.ts:7'])
})
