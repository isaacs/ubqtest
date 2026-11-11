// Start cost of isolation units from a warm parent process.
import { Worker } from 'node:worker_threads'
import { fork, spawn } from 'node:child_process'
import { once } from 'node:events'
import vm from 'node:vm'
const med = a => a.sort((x, y) => x - y)[a.length >> 1]
const time = async (n, f) => { const r = []; for (let i = 0; i < n; i++) { const t = performance.now(); await f(); r.push(performance.now() - t) } return +med(r).toFixed(2) }
const out = {}
out.workerReady = await time(30, async () => { const w = new Worker('require("node:worker_threads").parentPort.postMessage(1)', { eval: true }); await once(w, 'message'); await w.terminate() })
out.workerExit = await time(30, async () => { const w = new Worker('1', { eval: true }); await once(w, 'exit') })
out.workerTsImport = await time(30, async () => { const w = new Worker(new URL('./e.ts', import.meta.url)); await once(w, 'exit') })
out.forkReady = await time(30, async () => { const c = fork('./ipc-child.mjs'); await once(c, 'message'); c.kill(); await once(c, 'exit') })
out.spawnExit = await time(30, async () => { const c = spawn(process.execPath, ['e.mjs'], { stdio: 'ignore' }); await once(c, 'exit') })
out.spawnTsExit = await time(30, async () => { const c = spawn(process.execPath, ['e.ts'], { stdio: 'ignore' }); await once(c, 'exit') })
out.vmContext = await time(200, async () => { vm.runInContext('1', vm.createContext({})) })
// parallel throughput: 64 units, 16 at a time
const pool = async (n, c, f) => { let i = 0; const t = performance.now(); await Promise.all(Array.from({ length: c }, async () => { while (i++ < n) await f() })); return +((performance.now() - t) / n).toFixed(2) }
out.spawnPer_c16 = await pool(128, 16, async () => { const c = spawn(process.execPath, ['e.mjs'], { stdio: 'ignore' }); await once(c, 'exit') })
out.workerPer_c16 = await pool(128, 16, async () => { const w = new Worker(new URL('./e.mjs', import.meta.url)); await once(w, 'exit') })
console.log(out)
