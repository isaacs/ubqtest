// A worker thread that reads the stack of a wedged main thread.
import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import { createServer } from 'node:net'
if (isMainThread) {
  const t0 = performance.now()
  const w = new Worker(new URL(import.meta.url)); w.unref()
  await new Promise(r => w.once('message', r))
  console.log('watchdog ready ms', (performance.now() - t0).toFixed(1))
  createServer().listen(0).unref()
  function parseForever (n) { let x = 0; while (true) x += n }
  function testBody () { return parseForever(1) }
  setTimeout(testBody, 20)
} else {
  const { Session } = await import('node:inspector/promises')
  const { writeSync } = await import('node:fs')
  const s = new Session(); s.connectToMainThread()
  parentPort.postMessage('ready')
  setTimeout(async () => {
    const t = performance.now()
    s.on('Debugger.paused', ({ params }) => {
      writeSync(1, `paused after ${(performance.now() - t).toFixed(1)} ms\n` + params.callFrames.slice(0, 3).map(f => `  ${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.location.lineNumber + 1}:${f.location.columnNumber + 1}`).join('\n') + '\n')
      process.exit(7)
    })
    await s.post('Debugger.enable')
    await s.post('Debugger.pause')
  }, 300)
}
