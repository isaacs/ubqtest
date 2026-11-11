// Cost of the run database: open, schema, inserts, and queries.
const t00 = performance.now()
const { DatabaseSync } = await import('node:sqlite')
const importMs = performance.now() - t00
import { rmSync } from 'node:fs'
const f = '/tmp/claude-501/run.db'; for (const s of ['', '-wal', '-shm']) rmSync(f + s, { force: true })
const ms = f => { const t = performance.now(); f(); return +(performance.now() - t).toFixed(2) }
const out = { importMs: +importMs.toFixed(2) }
let db
out.openCreateMs = ms(() => {
  db = new DatabaseSync(f)
  db.exec(`pragma journal_mode=wal; pragma synchronous=normal;
  create table run(id integer primary key, started real, meta text);
  create table test(id integer primary key, run integer, file text, name text, status text, ms real, line integer);
  create table assertion(id integer primary key, test integer, ok integer, line integer, col integer, msg text, detail text);
  create table cov(test integer, file integer, start integer, end integer, count integer);
  create index test_run on test(run, status); create index cov_file on cov(file, start);`)
})
const N = 2000, A = 5, R = 20 // tests, assertions per test, coverage ranges per test
out.insertMs = ms(() => {
  db.exec('begin')
  db.prepare('insert into run values(1, ?, ?)').run(Date.now(), '{}')
  const it = db.prepare('insert into test values(?,?,?,?,?,?,?)'), ia = db.prepare('insert into assertion values(null,?,?,?,?,?,?)'), ic = db.prepare('insert into cov values(?,?,?,?,?)')
  for (let i = 0; i < N; i++) {
    it.run(i, 1, `test/f${i % 200}.ts`, `file ${i % 200} test ${i}`, i % 97 ? 'pass' : 'fail', 0.1, i)
    for (let a = 0; a < A; a++) ia.run(i, 1, a, 3, 'equal', null)
    for (let r = 0; r < R; r++) ic.run(i, i % 20, r * 50 + i, r * 50 + i + 40, 1)
  }
  db.exec('commit')
})
out.rows = N * (1 + A + R)
out.usPerRow = +(out.insertMs * 1000 / out.rows).toFixed(2)
out.queryFailuresMs = ms(() => db.prepare(`select file, name, line from test where run=1 and status='fail'`).all())
out.queryCoversMs = ms(() => db.prepare(`select distinct test from cov where file=3 and start<=5000 and end>=5000`).all())
db.close()
out.reopenMs = ms(() => { db = new DatabaseSync(f); db.prepare('select count(*) from test').get() })
import { statSync } from 'node:fs'
out.fileKB = Math.round(statSync(f).size / 1024)
console.log(out)
