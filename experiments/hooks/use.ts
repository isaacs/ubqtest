import { mockImport, graph } from './mock.ts'
import { Session } from 'node:inspector'
const s = new Session(); s.connect(); s.post('Profiler.enable'); s.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
type Subject = typeof import('./subject.ts')
type Deps = { './dep.ts': typeof import('./dep.ts') }
const real = await import('./subject.ts')
const a = await mockImport<Subject, Deps>(new URL('./subject.ts', import.meta.url), { './dep.ts': { fetchUser: id => ({ id, name: 'mocked' }), other: () => 'mock other' } })
const b = await mockImport<Subject, Deps>(new URL('./subject.ts', import.meta.url), { './dep.ts': { fetchUser: id => ({ id, name: 'second' }), other: () => 'x' } })
console.log(real.greet(1), '|', a.greet(1), '|', b.greet(1), '| fresh instances:', a !== b && a !== real)
s.post('Profiler.takePreciseCoverage', (e, r) => console.log('coverage urls:', r.result.map(x => x.url.split('/').pop()).filter(u => u.includes('subject') || u.startsWith('mock'))))
console.log('graph:', [...graph].map(([k, v]) => `${k.split('/').pop()} -> ${[...v].map(x => x.split('/').pop())}`))
