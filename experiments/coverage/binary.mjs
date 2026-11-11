// Does binary mode (callCount:false) stay correct for per-test deltas
// after a function gets hot and optimized? And what does it cost?
// usage: node binary.mjs <callCount 0|1> <detailed 0|1>
import { Session } from 'node:inspector'
const callCount = process.argv[2] === '1', detailed = process.argv[3] === '1'
const session = new Session(); session.connect()
const post = (m, p) => { let r, e; session.post(m, p, (err, res) => { e = err; r = res }); if (e) throw e; return r }
post('Profiler.enable'); post('Profiler.startPreciseCoverage', { callCount, detailed })
function f(a, b) {
  let t = 0
  if (a > b) { t = a - b } else { t = b - a }
  for (let i = 0; i < 3; i++) { t += i % 2 ? a : b }
  return a && b ? t : t + 1
}
function g(a) { return a > 5 ? 'big' : 'small' }
const mine = () => post('Profiler.takePreciseCoverage').result.filter(s => s.url.includes('binary.mjs')).flatMap(s => s.functions).filter(fn => ['f', 'g'].includes(fn.functionName)).map(fn => `${fn.functionName}:${fn.ranges.map(r => `${r.startOffset}-${r.endOffset}=${r.count}`).join(',')}`)
mine()
// test 1: make f hot
let t = performance.now(); let x = 0
for (let i = 0; i < 3e6; i++) x += f(i, 7)
const hotMs = performance.now() - t
console.log('t1 (f hot)   ', mine())
// test 2: call f once more, and g for the first time on one branch
f(1, 2); g(1)
console.log('t2 (f, g lo) ', mine())
// test 3: nothing
console.log('t3 (nothing) ', mine())
// test 4: g other branch only; f again hot
g(10); for (let i = 0; i < 1e6; i++) x += f(i, 7)
console.log('t4 (f, g hi) ', mine())
console.log({ callCount, detailed, hotMs: +hotMs.toFixed(1) })
