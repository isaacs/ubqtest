// Can a Bun program get the JavaScript that Bun made from a module,
// and a source map for it, through node:inspector?
import { Session } from 'node:inspector'
import { pick } from './src.ts'
const s = new Session()
s.connect()
const post = (method: string, params?: object): Promise<any> =>
  new Promise((resolve, reject) => s.post(method as any, params as any, (e: any, r: any) => (e ? reject(e) : resolve(r))))
const parsed: any[] = []
s.on('Debugger.scriptParsed' as any, (m: any) => parsed.push(m.params))
await post('Profiler.enable')
await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
try { console.log('debugger', await post('Debugger.enable')) } catch (e) { console.log('Debugger.enable throws', String(e)) }
pick(0, null)
const r = await post('Profiler.takePreciseCoverage')
const mine = r.result.find((x: any) => String(x.url).includes('src.ts'))
console.log('static import, late start:', JSON.stringify(mine)?.slice(0, 600))
console.log('scriptParsed', parsed.length, JSON.stringify(parsed.find(p => String(p.url).includes('src.ts'))))
for (const id of [mine?.scriptId]) {
  try { const src = await post('Debugger.getScriptSource', { scriptId: id }); console.log(JSON.stringify(src).slice(0, 700)) } catch (e) { console.log('getScriptSource throws', String(e)) }
}
