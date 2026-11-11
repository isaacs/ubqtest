import { mockImport } from './mock.ts'
type Subject = typeof import('./subject.ts')
type Deps = { './dep.ts': typeof import('./dep.ts') }
await mockImport<Subject, Deps>(new URL('./subject.ts', import.meta.url), { './dep.ts': { fetchUser: (id: string) => ({ id: 1, name: 2 }), nope: 1 } })
