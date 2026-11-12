// What does a test file cost in a process that is already started?
// A warm child loaded the coverage preload, and waits in a sync
// read of stdin for the path of its test file.
// usage (from experiments/suite): node ../server/warm.mjs
import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const here = import.meta.dirname
const preload = pathToFileURL(resolve(here, '../../dist/counters-preload.js')).href
const cc = resolve(here, '../../.ubq/compile-cache')
const stub = resolve(here, 'stub.mjs')
writeFileSync(stub, `import { readSync } from 'node:fs'
const buffer = Buffer.alloc(65536)
const job = JSON.parse(buffer.toString('utf8', 0, readSync(0, buffer)))
Object.assign(process.env, job.env)
process.argv[1] = job.file
await import(job.file)
`)
const file = n => resolve('t-ubq', `f${n}.test.ts`)
const env = n => ({ UBQ_CHILD: '1', UBQ_CAPTURE: '1', UBQ_FILE: `t-ubq/f${n}.test.ts`, UBQ_LINES: '', UBQ_IDS: '[]' })
const base = { ...process.env, NODE_COMPILE_CACHE: cc }
const done = child => new Promise(r => child.on('close', r))
const stdio = ['pipe', 'ignore', 'inherit', 'ignore']

const cold = n => done(spawn(process.execPath, ['--inspect-port=0', '--import', preload, file(n)], { stdio, env: { ...base, ...env(n) } }))
const warmStart = () => spawn(process.execPath, ['--inspect-port=0', '--import', preload, stub], { stdio, env: base })
const warmRun = (child, n) => { child.stdin.end(JSON.stringify({ file: file(n), env: env(n) })); return done(child) }

const time = async fn => { const t = performance.now(); await fn(); return performance.now() - t }
const mean = a => (a.reduce((x, y) => x + y) / a.length).toFixed(1)
for (const count of [1, 3, 5, 16]) {
  const colds = [], warms = []
  for (let i = 0; i < 6; i++) {
    const ids = Array.from({ length: count }, (_, k) => k)
    const c = await time(() => Promise.all(ids.map(cold)))
    const pool = ids.map(warmStart)
    await new Promise(r => setTimeout(r, 400))
    const w = await time(() => Promise.all(ids.map((n, k) => warmRun(pool[k], n))))
    if (i) { colds.push(c); warms.push(w) }
  }
  console.log(`${count} files: cold ${mean(colds)} ms, warm ${mean(warms)} ms`)
}
for (const args of [['t-ubq/f0.test.ts'], ['t-ubq/f0.test.ts', 't-ubq/f1.test.ts', 't-ubq/f2.test.ts'], [0, 1, 2, 3, 4].map(n => `t-ubq/f${n}.test.ts`)]) {
  const times = []
  for (let i = 0; i < 6; i++) {
    const t = performance.now()
    spawnSync(process.execPath, [resolve(here, '../../dist/cli.js'), ...args], { stdio: 'ignore' })
    if (i) times.push(performance.now() - t)
  }
  console.log(`ubq, ${args.length} files: ${mean(times)} ms`)
}
const t = []
for (let i = 0; i < 6; i++) { const s = performance.now(); spawnSync(process.execPath, ['-e', '0']); if (i) t.push(performance.now() - s) }
console.log(`node -e 0: ${mean(t)} ms`)
