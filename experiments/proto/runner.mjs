// usage: node runner.mjs <mode> <dir> [jobs]
// mode: process | worker | shared
import { spawn } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import { once } from 'node:events'
import { readdirSync, rmSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
const [mode, dir, jobs = availableParallelism()] = process.argv.slice(2)
const t0 = performance.now()
const files = readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => resolve(dir, f))
const env = { ...process.env, NODE_COMPILE_CACHE: resolve(import.meta.dirname, '.cc'), PROTO_FD: '3' }
const events = []
const readLines = s => { let b = ''; s.setEncoding('utf8'); s.on('data', d => { b += d; let i; while ((i = b.indexOf('\n')) >= 0) { events.push(JSON.parse(b.slice(0, i))); b = b.slice(i + 1) } }) }
const runProc = async args => { const p = spawn(process.execPath, args, { env, stdio: ['ignore', 'inherit', 'inherit', 'pipe'] }); readLines(p.stdio[3]); await once(p, 'close') }
const J = Math.min(+jobs, files.length)
if (mode === 'shared') {
  const per = Math.ceil(files.length / J)
  await Promise.all(Array.from({ length: J }, (_, i) => files.slice(i * per, (i + 1) * per)).filter(a => a.length).map(a => runProc([resolve(import.meta.dirname, 'shared-child.mjs'), ...a])))
} else {
  let i = 0
  await Promise.all(Array.from({ length: J }, async () => {
    while (i < files.length) {
      const f = files[i++]
      if (mode === 'process') await runProc([f])
      else { const w = new Worker(new URL('./worker-child.mjs', import.meta.url), { workerData: { proto: true, file: f }, env }); w.on('message', m => { for (const e of m) events.push(e) }); await once(w, 'exit') }
    }
  }))
}
const tRun = performance.now()
// database sink
const dbf = '/tmp/claude-501/proto.db'; for (const s of ['', '-wal', '-shm']) rmSync(dbf + s, { force: true })
const db = new DatabaseSync(dbf)
db.exec(`pragma journal_mode=wal; pragma synchronous=normal; create table test(id text primary key, file text, ok integer, ms real, n integer, err text); create table assertion(test text, ok integer, msg text, detail text, stack text); create table cov(test text, file text, s integer, e integer, c integer); begin`)
const it = db.prepare('insert into test values(?,?,?,?,?,?)'), ia = db.prepare('insert into assertion values(?,?,?,?,?)'), ic = db.prepare('insert into cov values(?,?,?,?,?)')
let pass = 0, fail = 0, asserts = 0, covRows = 0
const fileOf = new Map()
for (const e of events) {
  if (e.e === 'test') fileOf.set(e.id, e.file)
  else if (e.e === 'assert') { asserts++; ia.run(e.test, e.ok, e.msg ?? null, e.detail ? JSON.stringify(e.detail) : null, e.stack ?? null) }
  else if (e.e === 'end') { e.ok ? pass++ : fail++; it.run(e.id, fileOf.get(e.id), +e.ok, e.ms, e.n, e.err ?? null); for (const [url, r] of e.cov ?? []) for (let i = 0; i < r.length; i += 3) { ic.run(e.id, url, r[i], r[i + 1], r[i + 2]); covRows++ } }
}
db.exec('commit'); db.close()
const tEnd = performance.now()
console.log(`${fail ? 'fail' : 'pass'}: ${fail} failed, ${pass} passed | mode=${mode} jobs=${J} files=${files.length} asserts=${asserts} covRows=${covRows} runMs=${(tRun - t0).toFixed(0)} dbMs=${(tEnd - tRun).toFixed(0)}`)
process.exitCode = fail ? 1 : 0
