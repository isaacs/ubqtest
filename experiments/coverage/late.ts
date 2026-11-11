// Coverage started after a static import already ran. TS offsets check.
import { used } from './dep.ts'
import ts from 'ts5'
import { Session } from 'node:inspector'
import { readFileSync } from 'node:fs'
const session = new Session(); session.connect()
const post = (m: string, p?: object): any => { let r: any, e: any; session.post(m as any, p as any, (err: any, res: any) => { e = err; r = res }); if (e) throw e; return r }
post('Profiler.enable'); post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
post('Profiler.takePreciseCoverage')
used(0, null)
let t = performance.now()
const res = post('Profiler.takePreciseCoverage').result
const first = performance.now() - t
const dep = res.find((s: any) => s.url.endsWith('dep.ts'))
const src = readFileSync(new URL('./dep.ts', import.meta.url), 'utf8')
for (const fn of dep?.functions ?? []) for (const r of fn.ranges) console.log(JSON.stringify(fn.functionName), r.count, JSON.stringify(src.slice(r.startOffset, r.endOffset).slice(0, 50)))
// use typescript a little so many of its functions exist
ts.transpileModule('const x: number = 1', {})
post('Profiler.takePreciseCoverage')
const N = 50; t = performance.now()
for (let i = 0; i < N; i++) { used(i, 'x'); post('Profiler.takePreciseCoverage') }
console.log({ firstTakeMs: +first.toFixed(2), takeMsWithTypescriptLoaded: +((performance.now() - t) / N).toFixed(2) })
