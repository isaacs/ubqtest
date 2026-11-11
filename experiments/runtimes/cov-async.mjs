// Per-test coverage deltas with an async inspector API (Deno, Bun).
import { Session } from 'node:inspector/promises'
const s = new Session(); s.connect()
await s.post('Profiler.enable'); await s.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
function f(a, b) { if (a > b) { return a - b } else { return b - a } }
function g(a) { return a > 5 ? 'big' : 'small' }
const mine = async () => { const t = performance.now(); const r = await s.post('Profiler.takePreciseCoverage'); const ms = (performance.now() - t).toFixed(2); return ms + 'ms ' + JSON.stringify((r?.result ?? []).filter(x => x.url.includes('cov-async')).flatMap(x => x.functions).filter(fn => ['f', 'g'].includes(fn.functionName)).map(fn => `${fn.functionName}:${fn.ranges.map(r => `${r.startOffset}-${r.endOffset}=${r.count}`).join(',')}`)) }
await mine()
f(1, 2); console.log('t1 f     ', await mine())
g(1); console.log('t2 g lo  ', await mine())
console.log('t3 none  ', await mine())
g(10); f(3, 1); console.log('t4 g hi f', await mine())
