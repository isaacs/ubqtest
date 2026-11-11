// Sends N events to the parent by the method in argv[2].
import { writeSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const [mode, N] = [process.argv[2], +process.argv[3]]
const ev = i => ({ t: 'assert', id: i, test: 'file 3 > parses empty input', ok: true, file: 'test/parse.ts', line: 42, col: 7, ms: 0.123, msg: 'expected values to be equal' })
const t0 = performance.now()
if (mode === 'ipc-json' || mode === 'ipc-adv') { for (let i = 0; i < N; i++) process.send(ev(i)) }
else if (mode === 'ipc-batch') { const a = []; for (let i = 0; i < N; i++) a.push(ev(i)); process.send(a) }
else if (mode === 'ipc-batch100') { let a = []; for (let i = 0; i < N; i++) { a.push(ev(i)); if (a.length === 100) { process.send(a); a = [] } } if (a.length) process.send(a) }
else if (mode === 'fd3-sync') { for (let i = 0; i < N; i++) writeSync(3, JSON.stringify(ev(i)) + '\n') }
else if (mode === 'fd3-batch') { let s = ''; for (let i = 0; i < N; i++) { s += JSON.stringify(ev(i)) + '\n'; if (s.length > 60000) { writeSync(3, s); s = '' } } if (s) writeSync(3, s) }
else if (mode === 'stdout') { let s = ''; for (let i = 0; i < N; i++) s += JSON.stringify(ev(i)) + '\n'; process.stdout.write(s) }
else if (mode === 'own-sqlite') {
  const db = new DatabaseSync(process.argv[4]); db.exec('pragma journal_mode=off; pragma synchronous=off; create table e(id integer, j text); begin')
  const ins = db.prepare('insert into e values(?,?)'); for (let i = 0; i < N; i++) ins.run(i, JSON.stringify(ev(i))); db.exec('commit'); db.close()
}
else if (mode === 'shared-wal') {
  const db = new DatabaseSync(process.argv[4], { timeout: 10000 }); db.exec('pragma synchronous=off; begin immediate')
  const ins = db.prepare('insert into e values(?,?)'); for (let i = 0; i < N; i++) ins.run(i, JSON.stringify(ev(i))); db.exec('commit'); db.close()
}
if (process.send && !mode.startsWith('ipc')) { /* no ipc */ }
process.stderr.write(String(performance.now() - t0))
