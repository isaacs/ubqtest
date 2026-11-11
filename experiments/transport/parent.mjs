// usage: node parent.mjs <events> <children>
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { rmSync, mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Worker } from 'node:worker_threads'
const [N, C] = [+process.argv[2], +process.argv[3]]
const dir = '/tmp/claude-501/transport'; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
const modes = { 'ipc-json': ['ipc'], 'ipc-adv': ['ipc', 'advanced'], 'ipc-batch': ['ipc'], 'ipc-batch100': ['ipc'], 'ipc-batch-adv': ['ipc', 'advanced'], 'fd3-sync': ['pipe'], 'fd3-batch': ['pipe'], stdout: [], 'own-sqlite': [], 'shared-wal': [], none: [] }
const res = {}
for (const [mode, [fd3, ser]] of Object.entries(modes)) {
  if (mode === 'shared-wal') { const db = new DatabaseSync(`${dir}/shared.db`); db.exec('pragma journal_mode=wal; create table e(id integer, j text)'); db.close() }
  const t0 = performance.now(); let got = 0, childMs = 0
  await Promise.all(Array.from({ length: C }, async (_, c) => {
    const p = spawn(process.execPath, ['child.mjs', mode.replace('-adv', mode === 'ipc-adv' ? '-adv' : ''), N, mode === 'shared-wal' ? `${dir}/shared.db` : `${dir}/c${c}.db`], { stdio: ['ignore', 'pipe', 'pipe', ...(fd3 ? [fd3] : [])], serialization: ser ?? 'json' })
    let err = ''; p.stderr.on('data', d => err += d)
    if (fd3 === 'ipc') p.on('message', m => { got += Array.isArray(m) ? m.length : 1 })
    const count = s => { let buf = ''; s.setEncoding('utf8'); s.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); got++ } }) }
    if (fd3 === 'pipe') count(p.stdio[3]); else if (mode === 'stdout') count(p.stdout); else p.stdout.resume()
    await once(p, 'close'); childMs += +err || 0
  }))
  if (mode === 'own-sqlite') { // merge the per-child files into one
    const db = new DatabaseSync(`${dir}/main.db`); db.exec('pragma synchronous=off; create table e(id integer, j text)')
    for (let c = 0; c < C; c++) { db.exec(`attach '${dir}/c${c}.db' as c; insert into e select * from c.e; detach c`) }
    got = db.prepare('select count(*) n from e').get().n; db.close()
  }
  if (mode === 'shared-wal') { const db = new DatabaseSync(`${dir}/shared.db`); got = db.prepare('select count(*) n from e').get().n; db.close() }
  res[mode] = { wallMs: +(performance.now() - t0).toFixed(1), childSendMs: +(childMs / C).toFixed(1), got }
}
// worker postMessage for comparison
{ const t0 = performance.now(); let got = 0
  await Promise.all(Array.from({ length: C }, async () => { const w = new Worker(`const {parentPort}=require('node:worker_threads');const a=[];for(let i=0;i<${N};i++)a.push({ t: 'assert', id: i, test: 'file 3 > parses empty input', ok: true, file: 'test/parse.ts', line: 42, col: 7, ms: 0.123, msg: 'expected values to be equal' });parentPort.postMessage(a)`, { eval: true }); w.on('message', m => got += m.length); await once(w, 'exit') }))
  res['worker-batch'] = { wallMs: +(performance.now() - t0).toFixed(1), got } }
console.log(`events=${N} children=${C}`); console.table(res)
