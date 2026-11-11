// Cost of Profiler.takePreciseCoverage at a test boundary.
// usage: node take.mjs <dir> <mode> <fnsCalledPerTest> <tests>
// mode: none | block | fn | besteffort
import { Session } from 'node:inspector'
import { performance } from 'node:perf_hooks'
const [dir, mode, K, T] = [process.argv[2], process.argv[3], +process.argv[4], +process.argv[5]]
const session = new Session()
session.connect()
const post = (m, p) => { let r, e; session.post(m, p, (err, res) => { e = err; r = res }); if (e) throw e; return r }
if (mode !== 'none') {
  post('Profiler.enable')
  if (mode !== 'besteffort')
    post('Profiler.startPreciseCoverage', { callCount: true, detailed: mode === 'block' })
}
const t0 = performance.now()
const mods = Object.values(await import(`./${dir}/index.mjs`))
const loadMs = performance.now() - t0
const fns = mods.flatMap(m => Object.values(m))
let takeMs = 0, workMs = 0, bytes = 0, entries = 0
let x = 0
for (let t = 0; t < T; t++) {
  const w0 = performance.now()
  for (let k = 0; k < K; k++) {
    const f = fns[(t * 7919 + k * 104729) % fns.length]
    for (let r = 0; r < 200; r++) x += f(r, k)
  }
  const w1 = performance.now()
  workMs += w1 - w0
  if (mode !== 'none') {
    const res = mode === 'besteffort' ? post('Profiler.getBestEffortCoverage') : post('Profiler.takePreciseCoverage')
    takeMs += performance.now() - w1
    if (t === T - 1) {
      // size of the useful part: scripts in our dir only
      const mine = res.result.filter(s => s.url.includes(dir))
      entries = mine.reduce((a, s) => a + s.functions.length, 0)
      bytes = JSON.stringify(mine).length
    }
  }
}
console.log(JSON.stringify({ dir, mode, fns: fns.length, K, T, loadMs: +loadMs.toFixed(1), workMsPerTest: +(workMs / T).toFixed(3), takeMsPerTest: +(takeMs / T).toFixed(3), lastEntries: entries, lastBytes: bytes, x: x % 7 }))
