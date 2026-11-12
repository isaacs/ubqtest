// What does one precise coverage snapshot cost on Bun?
import { Session } from 'node:inspector'
const s = new Session()
s.connect()
const post = (method: string, params?: object): Promise<any> =>
  new Promise((resolve, reject) => s.post(method as any, params as any, (e: any, r: any) => (e ? reject(e) : resolve(r))))
await post('Profiler.enable')
await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
const { instrument } = await import('../../src/instrument.ts')
instrument('const a = 1', 'a.js')
const t0 = performance.now()
let scripts = 0
for (let i = 0; i < 50; i++) scripts = (await post('Profiler.takePreciseCoverage')).result.length
console.log(`${((performance.now() - t0) / 50).toFixed(3)} ms for each snapshot, ${scripts} scripts`)
