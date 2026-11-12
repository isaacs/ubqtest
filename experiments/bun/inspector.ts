// Does node:inspector on Bun give per-test coverage (precise
// coverage with counts, taken more than one time)?
import { Session } from 'node:inspector'
const s = new Session()
s.connect()
const post = (method: string, params?: object): Promise<any> =>
  new Promise((resolve, reject) => s.post(method as any, params as any, (e: any, r: any) => (e ? reject(e) : resolve(r))))
console.log('enable', await post('Profiler.enable'))
console.log('start', await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true }))
const { pick } = await import('./src.ts')
const take = async (label: string) => {
  try {
    const r = await post('Profiler.takePreciseCoverage')
    const mine = (r.result ?? []).filter((x: any) => String(x.url).includes('src.ts'))
    console.log(label, 'scripts', r.result?.length, JSON.stringify(mine).slice(0, 900))
  } catch (e) { console.log(label, 'throws', String(e)) }
}
await take('load')
pick(0, null)
await take('after pick(0)')
pick(5, null)
await take('after pick(5)')
await take('nothing ran')
