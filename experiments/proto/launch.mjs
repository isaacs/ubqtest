// One-file fast path: the CLI turns on the compile cache and
// coverage, then imports the test file into its own process.
// Also prints the dependency list from the first snapshot.
import { enableCompileCache } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
enableCompileCache(resolve(import.meta.dirname, '.cc'))
const { Session } = await import('node:inspector')
const s = new Session(); s.connect()
s.post('Profiler.enable'); s.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
process.env.PROTO_COV = '0' // this script owns coverage here
await import(pathToFileURL(resolve(process.argv[2])))
if (process.argv[3] === 'deps') s.post('Profiler.takePreciseCoverage', (e, r) => console.log('loaded:', r.result.map(x => x.url).filter(u => u.startsWith('file:') && !u.includes('/proto/')).map(u => u.split('/').slice(-2).join('/'))))
