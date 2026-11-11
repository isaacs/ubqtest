// Steady-state cost of coverage counters on hot code.
// usage: node hot.mjs <mode>
import { Session } from 'node:inspector'
const mode = process.argv[2]
const session = new Session(); session.connect()
const post = (m, p) => { let r, e; session.post(m, p, (err, res) => { e = err; r = res }); if (e) throw e; return r }
if (mode !== 'none') { post('Profiler.enable'); post('Profiler.startPreciseCoverage', { callCount: true, detailed: mode === 'block' }) }
function f(a, b) {
  let t = 0
  if (a > b) { t = a - b } else { t = b - a }
  for (let i = 0; i < 3; i++) { t += i % 2 ? a : b }
  return a && b ? t : t + 1
}
const parse = s => JSON.parse(s).map(o => ({ ...o, k: Object.keys(o).length })).filter(o => o.k > 1).length
const src = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ i, s: 'x'.repeat(i), n: [i, i + 1] })))
const res = {}
for (const [name, fn, n] of [['arith', () => { let x = 0; for (let i = 0; i < 3e7; i++) x += f(i, 7); return x }, 5], ['alloc', () => { let x = 0; for (let i = 0; i < 3000; i++) x += parse(src); return x }, 5]]) {
  let best = Infinity
  for (let i = 0; i < n; i++) { const t = performance.now(); fn(); best = Math.min(best, performance.now() - t) }
  res[name] = +best.toFixed(1)
}
console.log(mode, JSON.stringify(res))
