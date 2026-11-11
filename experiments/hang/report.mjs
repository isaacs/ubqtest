// Can we say what keeps a wedged test alive, with creation stacks?
import { createHook } from 'node:async_hooks'
import { createServer } from 'node:net'
const live = new Map()
createHook({ init (id, type, trigger, resource) { if (type !== 'PROMISE' && type !== 'TickObject' && type !== 'Immediate') live.set(id, { type, at: new Error(), resource }) }, destroy (id) { live.delete(id) } }).enable()
function startServer () { const s = createServer(); s.listen(0); return s }
function leakTimer () { return setInterval(() => {}, 1000) }
const s = startServer(); const i = leakTimer(); const t = setTimeout(() => {}, 5)
await new Promise(r => setTimeout(r, 20))
console.log('active:', process.getActiveResourcesInfo())
for (const [, { type, at, resource }] of live) {
  if (resource.hasRef && !resource.hasRef()) continue
  const frame = at.stack.split('\n').find(l => l.includes('file://') && !l.includes('AsyncHook.init'))
  console.log(type.padEnd(14), frame?.trim())
}
s.close(); clearInterval(i)
