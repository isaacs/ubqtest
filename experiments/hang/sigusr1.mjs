// Parent reads the stack of a busy-looped child: SIGUSR1 starts the
// inspector in the child, then the parent pauses it over WebSocket.
import { spawn } from 'node:child_process'
const p = spawn(process.execPath, ['--inspect-port=0', 'busy.mjs'], { stdio: ['ignore', 'inherit', 'pipe'] })
const kill = setTimeout(() => { console.log('gave up'); p.kill('SIGKILL'); process.exit(1) }, 5000)
await new Promise(r => setTimeout(r, 300))
const t = performance.now()
p.kill('SIGUSR1')
let err = ''
const url = await new Promise(r => p.stderr.on('data', d => { err += d; const m = /ws:\/\/\S+/.exec(err); if (m) r(m[0]) }))
const ws = new WebSocket(url)
await new Promise(r => ws.onopen = r)
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data)
  if (m.method !== 'Debugger.paused') return
  console.log(`stack after ${(performance.now() - t).toFixed(0)} ms`)
  for (const f of m.params.callFrames.slice(0, 3)) console.log(`  ${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.location.lineNumber + 1}:${f.location.columnNumber + 1}`)
  clearTimeout(kill); p.kill('SIGKILL'); process.exit(0)
}
ws.send(JSON.stringify({ id: 1, method: 'Debugger.enable' }))
ws.send(JSON.stringify({ id: 2, method: 'Debugger.pause' }))
