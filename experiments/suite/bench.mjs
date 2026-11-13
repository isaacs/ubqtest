// Times ubq and other frameworks on the same suite.
// usage: node bench.mjs [--runs N] [--only text] [--check]
//   --check  exit 1 if a ubq row is over its budget
// A budget is a guard against a regression: the measured time plus
// a small margin, on the machine in docs/03-measurements.md, as
// measured again on 2026-11-13 (`node -e 0`: 31.8 ms). The
// targets are in docs/04-architecture.md, section 12.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const here = import.meta.dirname
const arg = n => { const i = process.argv.indexOf(n); return i < 0 ? undefined : process.argv[i + 1] ?? '' }
const runs = +(arg('--runs') ?? 5)
const only = arg('--only')
const check = process.argv.includes('--check')
const bin = n => resolve(here, '../node_modules/.bin', n)
const ubq = resolve(here, '../../dist/cli.js')
const cc = resolve(here, '../../.ubq/compile-cache')

if (!existsSync(resolve(here, 't-ubq'))) spawnSync(process.execPath, ['gen.mjs', '200', '10'], { cwd: here, stdio: 'inherit' })

// [name, command, args, { budget ms, env }]
const rows = [
  ['ubq plain, 1 file', 'node', ['t-ubq/f0.test.ts'], { budget: 88 }],
  ['ubq plain, 1 file, compile cache', 'node', ['t-ubq/f0.test.ts'], { budget: 65, env: { NODE_COMPILE_CACHE: cc } }],
  ['ubq, 1 file', 'node', [ubq, 't-ubq/f0.test.ts'], { budget: 65 }],
  ['ubq, 200 files', 'node', [ubq, 't-ubq'], { budget: 1000 }],
  ['node:test, 1 file', 'node', ['--test', 't-nodetest/f0.test.ts']],
  ['vitest, 1 file', bin('vitest'), ['run', 't-vitest/f0.test.ts']],
  ['jest, 1 file', bin('jest'), ['t-jest/f0.test.ts']],
  ['bun test, 1 file', 'bun', ['test', 't-bun/f0.test.ts']],
  ['deno test, 1 file', 'deno', ['test', '-A', '--no-check', 't-deno/f0.test.ts']],
  ['node:test, 200 files', 'node', ['--test', 't-nodetest/*.test.ts']],
  ['vitest, 200 files', bin('vitest'), ['run']],
  ['vitest no isolation, 200 files', bin('vitest'), ['run', '--pool=threads', '--no-isolate']],
  ['jest, 200 files', bin('jest'), []],
  ['bun test, 200 files', 'bun', ['test', 't-bun']],
  ['deno test --parallel, 200 files', 'deno', ['test', '-A', '--no-check', '--parallel', 't-deno']],
].filter(r => !only || r[0].includes(only))

let over = 0
const table = {}
for (const [name, cmd, args, opt = {}] of rows) {
  const times = []
  let status = 0
  for (let i = 0; i < runs + 1; i++) {
    const t = performance.now()
    const r = spawnSync(cmd, args, { cwd: here, stdio: 'ignore', env: { ...process.env, ...opt.env } })
    if (i) times.push(performance.now() - t) // run 0 warms caches
    status = r.status ?? -1
  }
  const mean = times.reduce((a, b) => a + b) / times.length
  const row = { 'min ms': +Math.min(...times).toFixed(1), 'mean ms': +mean.toFixed(1), exit: status }
  if (opt.budget) { row['budget ms'] = opt.budget; if (mean > opt.budget) { row.over = 'OVER'; over++ } }
  table[name] = row
}
console.table(table)
if (check && over) { console.error(`${over} row(s) over budget`); process.exit(1) }
