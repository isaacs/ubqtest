// Typed, scoped module mocks and a dependency graph through
// module.registerHooks, with no flags.
import { registerHooks } from 'node:module'
const mocks = new Map<string, Record<string, Record<string, unknown>>>()
;(globalThis as any)[Symbol.for('proto.mocks')] = mocks
export const graph = new Map<string, Set<string>>()
let n = 0
registerHooks({
  resolve (spec, ctx, next) {
    const parent = ctx.parentURL
    const id = parent && new URL(parent).searchParams.get('mock')
    const r = next(spec, ctx)
    if (parent) { const k = parent.split('?')[0]; (graph.get(k) ?? graph.set(k, new Set()).get(k)!).add(r.url.split('?')[0]) }
    if (!id) return r
    const m = mocks.get(id)!
    if (spec in m) return { url: `mock:${id}:${encodeURIComponent(spec)}`, shortCircuit: true }
    // modules under the mocked subject get fresh instances too
    return r.url.startsWith('file:') && !r.url.includes('/node_modules/') ? { ...r, url: `${r.url}?mock=${id}` } : r
  },
  load (url, ctx, next) {
    if (!url.startsWith('mock:')) return next(url, ctx)
    const [, id, spec] = url.split(':')
    const keys = Object.keys(mocks.get(id)![decodeURIComponent(spec)])
    const src = `const m = globalThis[Symbol.for('proto.mocks')].get(${JSON.stringify(id)})[${JSON.stringify(decodeURIComponent(spec))}]\n` + keys.map(k => k === 'default' ? `export default m.default` : `export const ${k} = m[${JSON.stringify(k)}]`).join('\n')
    return { format: 'module', source: src, shortCircuit: true }
  },
})
// The second type argument ties each mock to the shape of the real
// module: a wrong key or a wrong signature is a compile error.
export const mockImport = async <M, D extends Record<string, object> = {}>(url: URL, deps: { [K in keyof D]: Partial<D[K]> }): Promise<M> => {
  const id = String(++n); mocks.set(id, deps as any)
  return await import(`${url.href}?mock=${id}`) as M
}
