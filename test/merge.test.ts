// Coverage from more than one environment, in one store (D54).
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { project } from './setup.ts'

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const bun = spawnSync('bun', ['--version']).status === 0
const system = process.platform

/** A project with a function that has a branch for each runtime. */
const make = () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  mkdirSync(join(p.dir, 'lib'))
  writeFileSync(
    join(p.dir, 'lib/where.ts'),
    `declare const Bun: unknown
export const where = (): string => {
  if (typeof Bun !== 'undefined') {
    return 'bun'
  }
  return 'node'
}
`,
  )
  writeFileSync(
    join(p.dir, 'where.test.ts'),
    `import { assert, test } from 'ubqtest'
import { where } from './lib/where.ts'
test('names the runtime', () => {
  assert.match(where(), /^(node|bun)$/)
})
`,
  )
  const run = (cmd: string, ...args: string[]): string[] =>
    spawnSync(cmd, [cli, ...args], { cwd: p.dir, encoding: 'utf8', env: { ...process.env, CI: '' } })
      .stdout.replace(/ \(run \d+\)\n$/, '')
      .trimEnd()
      .split('\n')
  return { ...p, run }
}
const BUN = 'lib/where.ts:3:35  { (+2 lines)'
// The range is on a line with `typeof Bun`. The command says where the way to run it is.
const NOTE =
  'note: 1 of these ranges are on a line that names a runtime or a system (process.platform, Bun, Deno). A run on one runtime and one system cannot run each of them. Run the tests in each environment, and merge the stores: see "Code for more than one runtime or system" in: ubq guide'

test('runs on two runtimes in one project fold together', { skip: !bun && 'bun is not installed', timeout: 60_000 }, () => {
  const p = make()
  assert.deepEqual(p.run('node'), ['pass: 0 failed, 1 passed'])
  assert.deepEqual(p.run('node', 'uncovered'), [BUN, '1 uncovered ranges in 1 of the 1 files that tests ran', NOTE])
  assert.deepEqual(p.run('bun'), ['pass: 0 failed, 1 passed'])
  // The run on Bun replaced the coverage of the test. The run on Node stays.
  const both = ['0 uncovered ranges in 0 of the 1 files that tests ran', `coverage of: bun-${system}, node-${system}`]
  assert.deepEqual(p.run('node', 'uncovered'), both)
  assert.deepEqual(p.run('node'), ['pass: 0 failed, 1 passed'])
  assert.deepEqual(p.run('node', 'uncovered'), both)
  // Coverage of a different content of a file does not count.
  appendFileSync(join(p.dir, 'lib/where.ts'), '// a change\n')
  assert.deepEqual(p.run('node'), ['pass: 0 failed, 1 passed'])
  assert.deepEqual(p.run('node', 'uncovered'), [
    BUN,
    '1 uncovered ranges in 1 of the 1 files that tests ran',
    `coverage of: bun-${system}, node-${system}`,
    NOTE,
  ])
})

test('merge adds the coverage of the store of a second copy of the project', { timeout: 60_000 }, () => {
  const p = make()
  assert.deepEqual(p.run('node'), ['pass: 0 failed, 1 passed'])
  // A copy with no runs, as a CI job that only merges.
  const copy = `${p.dir}-copy`
  cleanup(() => rmSync(copy, { recursive: true, force: true }))
  mkdirSync(copy)
  for (const name of ['package.json', 'lib', 'where.test.ts']) cpSync(join(p.dir, name), join(copy, name), { recursive: true })
  const ubq = (...args: string[]) => {
    const r = spawnSync('node', [cli, ...args], { cwd: copy, encoding: 'utf8' })
    return [r.status, r.stdout.trimEnd().split('\n')]
  }
  assert.deepEqual(ubq('merge', p.dir), [0, [`merged ${p.dir}: 4 coverage rows of node-${system}`]])
  assert.deepEqual(ubq('uncovered'), [1, [BUN, '1 uncovered ranges in 1 of the 1 files that tests ran', NOTE]])
  assert.deepEqual(ubq('covers', 'lib/where.ts:6'), [0, ['where.test.ts > names the runtime', '1 tests run lib/where.ts:6']])
  // A store of a different content of a file.
  appendFileSync(join(copy, 'lib/where.ts'), '// a change\n')
  assert.deepEqual(ubq('merge', join(p.dir, '.ubq')), [
    0,
    [
      `merged ${join(p.dir, '.ubq')}: 4 coverage rows of node-${system}`,
      'note: 1 files are not the same here as in a store that was merged: lib/where.ts. Coverage of a file counts only if the file has the same content. Make each store from the same commit.',
    ],
  ])
  assert.deepEqual(ubq('uncovered'), [
    1,
    [
      'lib/where.ts  the stored coverage is of a different content of this file. Run the tests again.',
      '0 uncovered ranges in 0 of the 1 files that tests ran',
    ],
  ])
  assert.deepEqual(ubq('merge', 'nope')[0], 4)
  const usage = (...args: string[]) => spawnSync('node', [cli, ...args], { cwd: copy, encoding: 'utf8' }).stderr
  assert.equal(usage('merge'), 'ubq: ubq merge needs the stores to add: a project folder, a .ubq folder, or a runs.db file\n')
  // A store with no coverage rows.
  const empty = join(copy, 'empty.db')
  cpSync(join(p.dir, '.ubq/runs.db'), empty)
  const db = new DatabaseSync(empty)
  db.exec('delete from coverage; delete from other_coverage')
  db.close()
  assert.deepEqual(ubq('merge', empty), [0, [`merged ${empty}: 0 coverage rows of no run`]])
  // A store of a different version of ubq.
  const old = join(copy, 'old.db')
  const oldDb = new DatabaseSync(old)
  oldDb.exec('pragma user_version = 1')
  oldDb.close()
  assert.equal(usage('merge', old), `ubq: ${old} is the store of a different version of ubq. Make it with the version of this project.\n`)
})

