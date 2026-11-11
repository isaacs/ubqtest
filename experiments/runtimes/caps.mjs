// Which building blocks exist on each runtime?
const out = {}
const tryIt = async (name, f) => { try { out[name] = await f() } catch (e) { out[name] = 'NO: ' + String(e.message ?? e).slice(0, 70) } }
await tryIt('inspector precise coverage', async () => {
  const { Session } = await import('node:inspector'); const s = new Session(); s.connect()
  let r, e, sync = false; s.post('Profiler.enable'); s.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
  const f = a => a ? 1 : 2; f(1)
  s.post('Profiler.takePreciseCoverage', (err, res) => { e = err; r = res; sync = true })
  if (!sync) await new Promise(r => setTimeout(r, 50))
  if (e) throw e
  return `yes, sync=${sync}, scripts=${r?.result?.length}`
})
await tryIt('diagnostics_channel', async () => { const dc = await import('node:diagnostics_channel'); let got; dc.subscribe('x', m => got = m); dc.channel('x').publish(1); return got === 1 ? 'yes' : 'no delivery' })
await tryIt('tracingChannel', async () => { const dc = await import('node:diagnostics_channel'); return typeof dc.tracingChannel === 'function' ? 'yes' : 'no' })
await tryIt('AsyncLocalStorage', async () => { const { AsyncLocalStorage } = await import('node:async_hooks'); const a = new AsyncLocalStorage(); return await a.run(7, async () => { await new Promise(r => setTimeout(r, 1)); return a.getStore() === 7 ? 'yes' : 'lost' }) })
await tryIt('async_hooks.createHook init', async () => { const ah = await import('node:async_hooks'); let n = 0; const h = ah.createHook({ init() { n++ } }).enable(); setTimeout(() => {}, 1); await new Promise(r => setTimeout(r, 2)); h.disable(); return n > 0 ? `yes (${n})` : 'no events' })
await tryIt('getActiveResourcesInfo', async () => { const t = setTimeout(() => {}, 1000); const r = process.getActiveResourcesInfo(); clearTimeout(t); return JSON.stringify(r) })
await tryIt('module.registerHooks', async () => { const m = await import('node:module'); return typeof m.registerHooks === 'function' ? 'yes' : 'no' })
await tryIt('module.enableCompileCache', async () => { const m = await import('node:module'); return typeof m.enableCompileCache === 'function' ? 'yes' : 'no' })
await tryIt('node:sqlite', async () => { const { DatabaseSync } = await import('node:sqlite'); const d = new DatabaseSync(':memory:'); return d.prepare('select sqlite_version() v').get().v })
await tryIt('node:test', async () => { const t = await import('node:test'); return typeof t.test })
await tryIt('using (explicit resource mgmt)', async () => { return (0, eval)('(()=>{ let d=0; { using x = { [Symbol.dispose]() { d = 1 } } } return d ? "yes" : "no" })()') })
await tryIt('writeSync fd 3', async () => { const fs = await import('node:fs'); fs.writeSync(3, 'hello-fd3\n'); return 'yes' })
await tryIt('process.send (ipc)', async () => typeof process.send)
await tryIt('unhandledRejection event', async () => { let got = false; process.once('unhandledRejection', () => got = true); Promise.reject(new Error('x')); await new Promise(r => setTimeout(r, 20)); return got ? 'yes' : 'no' })
await tryIt('Error.captureStackTrace', async () => typeof Error.captureStackTrace)
await tryIt('performance.now µs', async () => { const a = performance.now(); return String(a % 1 !== 0) })
console.log(JSON.stringify(out, null, 1))
