// Hard cases for coverage of a child process through a preload
// module that the child gets from NODE_OPTIONS.
// Run from the repository root: node experiments/child/cases.ts
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'ubq-cases-'))
const out = join(dir, 'out')
spawnSync('mkdir', [out])
// The preload: says that it ran, patches the spawn functions, and
// writes when the process ends, also for a signal.
const preload = join(dir, 'preload.mjs')
writeFileSync(
  preload,
  `import { writeFileSync, appendFileSync } from 'node:fs'
import childProcess, { ChildProcess } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { threadId } from 'node:worker_threads'
const out = process.env.TRIAL_OUT
const mine = { NODE_OPTIONS: process.env.NODE_OPTIONS, TRIAL_OUT: out }
const note = text => appendFileSync(out + '/log', text + '\\n')
note('loaded ' + process.argv.slice(1).join(' ') + ' thread ' + threadId)
// A child with a new environment must get the variables too.
const spawnAsync = ChildProcess.prototype.spawn
ChildProcess.prototype.spawn = function (options) {
  for (const [key, value] of Object.entries(mine))
    if (!options.envPairs.some(pair => pair.startsWith(key + '='))) options.envPairs.push(key + '=' + value)
  return spawnAsync.call(this, options)
}
for (const name of ['spawnSync', 'execFileSync', 'execSync']) {
  const real = childProcess[name]
  childProcess[name] = (...args) => {
    const options = args.find(a => a && typeof a === 'object' && !Array.isArray(a))
    if (options?.env) options.env = { ...mine, ...options.env }
    return real(...args)
  }
}
syncBuiltinESMExports()
process.on('exit', () => note('exit ' + process.argv[1]))
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'])
  process.on(signal, function handler() {
    // Only if the program has no handler of its own.
    if (process.listenerCount(signal) > 1) return
    note('signal ' + signal + ' ' + process.argv[1])
    process.removeListener(signal, handler)
    process.kill(process.pid, signal)
  })
`,
)
const script = (name: string, text: string): string => {
  writeFileSync(join(dir, name), text)
  return join(dir, name)
}
const env = { ...process.env, NODE_OPTIONS: `--import ${pathToFileURL(preload).href}`, TRIAL_OUT: out }
const log = (): string[] => readFileSync(join(out, 'log'), 'utf8').trim().split('\n')
const fresh = (): void => writeFileSync(join(out, 'log'), '')

// 1. A child that starts a child with an environment of its own, in 3 ways.
fresh()
const grand = script('grand.mjs', 'console.log("grand")')
const parent = script(
  'parent.mjs',
  `import { spawn, spawnSync, execFileSync } from 'node:child_process'
const env = { PATH: process.env.PATH }
spawnSync(process.execPath, [${JSON.stringify(grand)}, 'sync'], { env })
execFileSync(process.execPath, [${JSON.stringify(grand)}, 'execFile'], { env })
await new Promise(done => spawn(process.execPath, [${JSON.stringify(grand)}, 'async'], { env }).on('close', done))
`,
)
spawnSync(process.execPath, [parent], { env })
console.log('1. a new environment:', log().filter(l => l.startsWith('loaded') && l.includes('grand')).map(l => l.split(' ')[2]).join(', '))

// 2. A server that the test stops with a signal.
fresh()
const server = script('server.mjs', 'import { createServer } from "node:http"\ncreateServer(() => {}).listen(0, () => console.log("up"))')
const child = spawn(process.execPath, [server], { env, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise(done => child.stdout.once('data', done))
child.kill('SIGTERM')
const [code, signal] = await new Promise<[number | null, string | null]>(done => child.on('close', (c, s) => done([c, s])))
console.log(`2. a server that gets SIGTERM: ended with code ${code}, signal ${signal};`, log().filter(l => !l.startsWith('loaded')).join(', ').replaceAll(dir + '/', ''))

// 3. A worker thread of the child.
fresh()
const worker = script('worker.mjs', `import { Worker, isMainThread } from 'node:worker_threads'\nif (isMainThread) new Worker(new URL(import.meta.url))`)
spawnSync(process.execPath, [worker], { env })
console.log('3. a worker thread:', log().filter(l => l.startsWith('loaded')).map(l => 'thread ' + l.split(' ').at(-1)).join(', '))

// 4. Other runtimes as the child.
for (const [runtime, extra, args] of [
  ['bun', { BUN_OPTIONS: `--preload ${preload}` }, []],
  ['deno', {}, ['run', '-A']],
] as const) {
  fresh()
  const r = spawnSync(runtime, [...args, grand], { env: { ...env, ...extra }, encoding: 'utf8' })
  console.log(`4. ${runtime} as the child:`, r.error ? 'not installed' : log().some(l => l.startsWith('loaded')) ? 'the preload ran' : 'the preload did not run')
}
void execFileSync
