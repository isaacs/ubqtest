// Prototype test library. Measures the floor cost of the design:
// serial tests, an event for each test and assertion, and a coverage
// snapshot at each test end. Not the real API.
import { Session } from 'node:inspector'
import { writeSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { parentPort, workerData } from 'node:worker_threads'

const COV = process.env.PROTO_COV !== '0'
const fd = process.env.PROTO_FD ? +process.env.PROTO_FD : null
const inWorker = !!workerData?.proto
let session
const post = (m, p) => { let r, e; session.post(m, p, (err, res) => { e = err; r = res }); if (e) throw e; return r }
if (COV) {
  session = new Session(); session.connect()
  post('Profiler.enable'); post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
}
const takeCov = () => {
  const out = []
  for (const s of post('Profiler.takePreciseCoverage').result) {
    if (!s.url.startsWith('file:') || s.url.includes('/node_modules/') || s.url.includes('/proto/')) continue
    const r = []
    for (const f of s.functions) for (const x of f.ranges) r.push(x.startOffset, x.endOffset, x.count)
    out.push([s.url, r])
  }
  return out
}

let buf = []
const emit = ev => { buf.push(ev) }
const flush = () => {
  if (!buf.length) return
  if (inWorker) parentPort.postMessage(buf)
  else if (fd !== null) writeSync(fd, buf.map(e => JSON.stringify(e)).join('\n') + '\n')
  buf = []
}

const queue = []
let draining = null
export let currentFile = process.argv[1]
export const setFile = f => { currentFile = f }
const stats = { pass: 0, fail: 0 }
class T {
  constructor (id) { this.id = id; this.n = 0 }
  #a (ok, msg, detail) {
    this.n++
    if (ok) emit({ e: 'assert', test: this.id, ok: 1 })
    else { emit({ e: 'assert', test: this.id, ok: 0, msg, detail, stack: new Error().stack }); this.failed = true }
  }
  equal (a, b, msg = 'equal') { this.#a(Object.is(a, b), msg, { a, b }) }
  deepEqual (a, b, msg = 'deepEqual') { this.#a(isDeepStrictEqual(a, b), msg, { a, b }) }
}
const drain = async () => {
  await null
  if (COV) post('Profiler.takePreciseCoverage') // drop load-time counts
  while (queue.length) {
    const { name, fn, file } = queue.shift()
    const id = `${file} > ${name}`
    emit({ e: 'test', id, file })
    const t = new T(id)
    const t0 = performance.now()
    let err
    try { await fn(t) } catch (e) { err = e }
    const ms = performance.now() - t0
    const ok = !err && !t.failed && t.n > 0
    stats[ok ? 'pass' : 'fail']++
    emit({ e: 'end', id, ok, ms, n: t.n, err: err?.stack, cov: COV ? takeCov() : undefined })
    flush()
  }
  draining = null
}
export const test = (name, fn) => {
  queue.push({ name, fn, file: currentFile })
  draining ??= drain()
}
export const done = () => draining ?? Promise.resolve()
if (fd === null && !inWorker) process.on('beforeExit', () => { if (stats.pass + stats.fail) { console.log(`${stats.fail ? 'fail' : 'pass'}: ${stats.fail} failed, ${stats.pass} passed`); stats.pass = stats.fail = 0 } })
