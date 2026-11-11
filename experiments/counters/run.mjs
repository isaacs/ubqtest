// Runs the 200-file suite as the ubq runner does (one process for
// each file, events on fd 3), with a given preload. No store.
// usage: node run.mjs <preload path> [--inspect-port=0]
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { resolve } from 'node:path'
const suite = resolve(import.meta.dirname, '../suite')
const files = readdirSync(`${suite}/t-ubq`).map(f => `t-ubq/${f}`)
const pre = resolve(process.argv[2])
const extra = process.argv.slice(3)
let tests = 0, cov = 0
const t0 = performance.now()
await Promise.all(Array.from({ length: availableParallelism() }, async () => {
  for (let f = files.shift(); f; f = files.shift()) {
    await new Promise(done => {
      const c = spawn(process.execPath, [...extra, '--import', pre, f], { cwd: suite, stdio: ['ignore', 'ignore', 'inherit', 'pipe'], env: { ...process.env, NODE_COMPILE_CACHE: `${suite}/.ubq/compile-cache`, UBQ_CHILD: '1', UBQ_FILE: f } })
      let buf = ''
      c.stdio[3].setEncoding('utf8').on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const e = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (e.type === 'test-end' && e.status === 'pass') tests++; if (e.type === 'coverage') cov++ } })
      c.on('close', done)
    })
  }
}))
console.log(`${(performance.now() - t0).toFixed(0)} ms, ${tests} passed, ${cov} coverage events`)
