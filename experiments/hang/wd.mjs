// Parent asks a wedged child for its stack and its handles.
import { spawn } from 'node:child_process'
import { readFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs'
import { once } from 'node:events'
const dir = '/tmp/claude-501/reports'; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
const t0 = performance.now()
const p = spawn(process.execPath, ['--report-on-signal', '--report-signal=SIGUSR2', `--report-directory=${dir}`, '--report-exclude-network', 'busy.mjs'], { stdio: 'inherit' })
await new Promise(r => setTimeout(r, 300))
const t1 = performance.now()
p.kill('SIGUSR2')
let f; while (!(f = readdirSync(dir)[0])) await new Promise(r => setTimeout(r, 5))
await new Promise(r => setTimeout(r, 30))
const rep = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))
console.log('report after ms:', (performance.now() - t1).toFixed(0))
console.log('stack:', rep.javascriptStack.stack.slice(0, 4))
console.log('handles:', rep.libuv.filter(h => h.is_active && h.is_referenced).map(h => `${h.type}${h.localEndpoint ? ' port ' + h.localEndpoint.port : ''}${h.firesInMsFromNow ? ' fires in ' + h.firesInMsFromNow : ''}`))
p.kill('SIGKILL'); await once(p, 'exit')
