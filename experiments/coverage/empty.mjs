// Floor cost of a snapshot in a process that loaded almost nothing.
import { Session } from 'node:inspector'
const session = new Session(); session.connect()
const post = (m, p) => { let r, e; session.post(m, p, (err, res) => { e = err; r = res }); if (e) throw e; return r }
let t = performance.now()
post('Profiler.enable'); post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
const startMs = performance.now() - t
t = performance.now(); const r = post('Profiler.takePreciseCoverage'); const first = performance.now() - t
const N = 200; t = performance.now()
for (let i = 0; i < N; i++) post('Profiler.takePreciseCoverage')
console.log({ startMs: +startMs.toFixed(2), firstTakeMs: +first.toFixed(2), firstScripts: r.result.length, takeMs: +((performance.now() - t) / N).toFixed(3) })
