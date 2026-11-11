// Can a worker thread get the stack of a busy main thread, with no
// flags? It sends SIGUSR1 to its own process (this starts the
// inspector) and then connects to the inspector over WebSocket.
import { Worker, isMainThread } from 'node:worker_threads'
if (isMainThread) {
  const t0 = performance.now()
  new Worker(new URL(import.meta.url)).unref()
  console.log('worker constructor ms', (performance.now() - t0).toFixed(2))
  function parseForever (n) { let x = 0; while (true) x += n }
  function testBody () { return parseForever(1) }
  setTimeout(testBody, 100)
} else {
  const inspector = await import('node:inspector')
  const { writeSync } = await import('node:fs')
  const log = s => writeSync(1, s + '\n')
  setTimeout(async () => {
    const t = performance.now()
    process.kill(process.pid, 'SIGUSR1')
    let url
    for (let i = 0; i < 100 && !url; i++) { await new Promise(r => setTimeout(r, 10)); url = inspector.url() }
    log(`inspector.url() in worker: ${url} after ${(performance.now() - t).toFixed(0)} ms`)
    if (!url) {
      // The default port, if url() does not work in a worker.
      try { const list = await (await fetch('http://127.0.0.1:9229/json/list')).json(); url = list[0].webSocketDebuggerUrl; log('from /json/list: ' + url) } catch (e) { log('no /json/list: ' + e.message) }
    }
    if (!url) process.kill(process.pid, 'SIGKILL')
    const ws = new WebSocket(url)
    ws.onerror = e => { log('ws error ' + e.message); process.kill(process.pid, 'SIGKILL') }
    ws.onopen = () => { ws.send(JSON.stringify({ id: 1, method: 'Debugger.enable' })); ws.send(JSON.stringify({ id: 2, method: 'Debugger.pause' })) }
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data)
      if (m.method !== 'Debugger.paused') return
      log(`stack after ${(performance.now() - t).toFixed(0)} ms: ` + m.params.callFrames.slice(0, 3).map(f => `${f.functionName}:${f.location.lineNumber + 1}`).join(' < '))
      process.kill(process.pid, 'SIGKILL')
    }
  }, 400)
}
