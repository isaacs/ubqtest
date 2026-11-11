// Can a library register a load hook at run time on Bun, with no
// flag, and change the source of a module that loads later?
import { plugin } from 'bun'
import { readFileSync } from 'node:fs'
const g = globalThis as any
g.__cov = new Map<string, Uint32Array>()
plugin({
  name: 'cov-probe',
  setup (build) {
    build.onLoad({ filter: /src\.ts$/ }, ({ path }) => {
      const src = readFileSync(path, 'utf8')
      g.__cov.set(path, new Uint32Array(2))
      // Hand-made counters on the same lines, to test the mechanism
      // and the line numbers in stack traces. Not a real instrumenter.
      const c = `globalThis.__cov.get(${JSON.stringify(path)})`
      const out = src.replace("{\n  if (a > 1) {", `{ ${c}[0]++;\n  if (a > 1) { ${c}[1]++;`).replace("return b ?? 'none'", "if (b === 'throw') throw new Error('line 5?'); return b ?? 'none'")
      return { contents: out, loader: 'ts' }
    })
  },
})
