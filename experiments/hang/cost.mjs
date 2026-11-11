// Cost of tracking async resources, for hang reports and for
// attribution of errors to tests.
// usage: node cost.mjs <none|als|hook|hook-stack|hook-stack-nopromise>
import { AsyncLocalStorage, createHook, executionAsyncId } from 'node:async_hooks'
import { readFile } from 'node:fs/promises'
const mode = process.argv[2]
const live = new Map()
if (mode.startsWith('hook')) {
  Error.stackTraceLimit = 12
  createHook({
    init (id, type) {
      if (mode === 'hook') live.set(id, type)
      else if (mode === 'hook-stack') live.set(id, { type, at: new Error() })
      else if (type !== 'PROMISE') live.set(id, { type, at: new Error() })
    },
    destroy (id) { live.delete(id) },
    promiseResolve (id) { live.delete(id) },
  }).enable()
}
const als = new AsyncLocalStorage()
const work = async () => {
  let x = 0
  const step = async i => { await null; return i }
  for (let i = 0; i < 200000; i++) x += await step(i)                      // 200k awaits
  for (let i = 0; i < 2000; i++) await new Promise(r => setImmediate(r))   // 2k immediates
  for (let i = 0; i < 200; i++) x += (await readFile(import.meta.filename)).length // 200 fs reads
  return x
}
const run = () => mode === 'none' ? work() : als.run({ test: 1 }, work)
await run()
const t = performance.now()
for (let i = 0; i < 5; i++) await run()
console.log(mode.padEnd(22), ((performance.now() - t) / 5).toFixed(1), 'ms per run', 'live=' + live.size)
