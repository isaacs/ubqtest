// Run-time check of the mockImport call shape in ubq.ts:
// loaders are thunks, and the hooks read the specifier from them.
import { registerHooks } from 'node:module'
type Loader<M> = () => Promise<M>
let capture: { url?: string } | undefined       // set while a mock loader runs
let pending: string | undefined                  // set while the subject loader runs
const table = new Map<string, Map<string, object>>() // mock id -> dep url -> exports
;(globalThis as any)[Symbol.for('ubq.mocks')] = table
let n = 0
registerHooks({
  resolve (spec, ctx, next) {
    const r = next(spec, ctx)
    if (capture) { capture.url = r.url; return { url: 'ubqstub:', shortCircuit: true } }
    if (pending) { const id = pending; pending = undefined; return { ...r, url: `${r.url}?mock=${id}` } }
    const id = ctx.parentURL && new URL(ctx.parentURL).searchParams.get('mock')
    if (!id) return r
    if (table.get(id)!.has(r.url)) return { url: `ubqmock:${id}:${r.url}`, shortCircuit: true }
    return r.url.startsWith('file:') && !r.url.includes('/node_modules/') ? { ...r, url: `${r.url}?mock=${id}` } : r
  },
  load (url, ctx, next) {
    if (url === 'ubqstub:') return { format: 'module', source: '', shortCircuit: true }
    if (!url.startsWith('ubqmock:')) return next(url, ctx)
    const [, id, ...rest] = url.split(':'); const dep = rest.join(':')
    const keys = Object.keys(table.get(id!)!.get(dep)!)
    return { format: 'module', shortCircuit: true, source: `const m = globalThis[Symbol.for('ubq.mocks')].get(${JSON.stringify(id)}).get(${JSON.stringify(dep)})\n` + keys.map(k => `export const ${k} = m[${JSON.stringify(k)}]`).join('\n') }
  },
})
export const mockImport = async <M, const D extends readonly unknown[]>(subject: Loader<M>, mocks: { [K in keyof D]: [Loader<D[K]>, Partial<D[K]>] }): Promise<M> => {
  const id = String(++n); const deps = new Map<string, object>(); table.set(id, deps)
  for (const [load, exports] of mocks as unknown as [Loader<unknown>, object][]) {
    capture = {}
    const p = load(); const url = capture.url; capture = undefined
    await p
    if (!url) throw new Error('mock loader must be () => import("...")')
    deps.set(url, exports)
  }
  pending = id
  const p = subject()
  if (pending) { pending = undefined; throw new Error('subject loader must be () => import("...")') }
  return await p
}
const real = await import('./src/greet.ts')
const a = await mockImport(() => import('./src/greet.ts'), [[() => import('./src/db.ts'), { fetchUser: async id => ({ id, name: 'ada' }) }]])
const b = await mockImport(() => import('./src/greet.ts'), [[() => import('./src/db.ts'), { fetchUser: async id => ({ id, name: 'bob' }) }]])
console.log(await real.greet(1), '|', await a.greet(1), '|', await b.greet(1), '|', await (await import('./src/greet.ts')).greet(1))
