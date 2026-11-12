// What does a browser cost with no driver package? Starts the same
// headless shell, and talks to it with the WebSocket of the runtime.
// `node cdp.ts <path of chrome-headless-shell>`
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ms = (from: number): string => (performance.now() - from).toFixed(0) + ' ms'
const dir = mkdtempSync(join(tmpdir(), 'cdp-'))
let t = performance.now()
const child = spawn(process.argv[2]!, ['--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
const url = await new Promise<string>(resolve => {
  let text = ''
  child.stderr.on('data', d => {
    text += d
    const m = /ws:\/\/\S+/.exec(text)
    if (m) resolve(m[0])
  })
})
const ws = new WebSocket(url)
await new Promise(resolve => (ws.onopen = resolve))
let id = 0
const waiting = new Map<number, (value: any) => void>()
ws.onmessage = e => {
  const m = JSON.parse(String(e.data))
  waiting.get(m.id)?.(m.result ?? m.error)
}
const send = (method: string, params = {}, sessionId?: string): Promise<any> =>
  new Promise(resolve => {
    waiting.set(++id, resolve)
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
console.log('launch and connect', ms(t))
t = performance.now()
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const r = await send('Runtime.evaluate', { expression: 'document.body.innerHTML = "<b>hi</b>"; document.querySelector("b").textContent' }, sessionId)
console.log('page and evaluate', ms(t), r.result.value)
ws.close()
child.kill()
child.on('exit', () => rmSync(dir, { recursive: true, force: true }))
