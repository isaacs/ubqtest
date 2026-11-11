// Does changed code behave the same as the original? Two real
// libraries run a workload, plain and with counters, and the
// results must be equal.
import { cpSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { COUNTERS } from '../../src/counters.ts'
import { instrument } from '../../src/instrument.ts'

const require = createRequire(import.meta.url)
const counters = new Map<string, Uint32Array>()
;(globalThis as any)[Symbol.for(COUNTERS)] = counters
mkdirSync('.tmp', { recursive: true })
const changed = (path: string, out: string): string => {
  const r = instrument(readFileSync(path, 'utf8'), out)
  if (!r) throw new Error(`cannot read ${path}`)
  counters.set(out, new Uint32Array(r.regions.length))
  writeFileSync(`.tmp/${out}`, r.code)
  return `./.tmp/${out}`
}
const hit = (out: string): string => {
  const c = counters.get(out)!
  return `${c.filter(Boolean).length} of ${c.length} counters ran`
}

// 1. acorn (ESM, 230 KB) parses JavaScript files.
{
  const plain = await import('acorn')
  const inst = await import(changed(require.resolve('acorn').replace(/acorn\.js$/, 'acorn.mjs'), 'acorn.mjs'))
  const files = globSync('../node_modules/{vitest,jest-*,tap,@tapjs/*}/**/*.{js,mjs}').slice(0, 600)
  let same = 0, differ = 0, bothThrow = 0
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    const run = (p: typeof plain): string => { try { return JSON.stringify(p.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })) } catch (e) { return 'THROW ' + (e as Error).message } }
    const [a, b] = [run(plain), run(inst)]
    if (a !== b) { differ++; console.log('DIFFERENT', f) } else if (a.startsWith('THROW')) bothThrow++
    else same++
  }
  console.log(`acorn: ${files.length} files parsed, ${same} equal trees, ${bothThrow} equal errors, ${differ} different; ${hit('acorn.mjs')}`)
}

// 2. typescript 5.9 (CommonJS, 9 MB) compiles TypeScript files.
{
  const plain = require('ts5')
  const t = performance.now()
  // The compiler finds its library type files next to its own
  // file, so the changed copy goes next to the original.
  const beside = require.resolve('ts5').replace(/typescript\.js$/, 'typescript.ubq.cjs')
  cpSync(changed(require.resolve('ts5'), 'typescript.cjs'), beside)
  const inst = require(beside)
  rmSync(beside)
  const loadMs = performance.now() - t
  const files = globSync('../../{src,test}/**/*.ts')
  let same = 0, differ = 0
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    const run = (ts: typeof plain): string => JSON.stringify(ts.transpileModule(src, { reportDiagnostics: true, compilerOptions: { target: 'es2020', module: 'commonjs', sourceMap: true } }))
    if (run(plain) === run(inst)) same++
    else { differ++; console.log('DIFFERENT', f) }
  }
  // The type checker: a full program with diagnostics.
  const check = (ts: typeof plain): string => {
    const program = ts.createProgram(['../api/good.ts', '../api/bad.ts'], { strict: true, noEmit: true, module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ESNext, allowImportingTsExtensions: true, skipLibCheck: true, types: [] })
    return ts.getPreEmitDiagnostics(program).map((d: any) => `${d.file?.fileName}:${d.start} ${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`).join('\n')
  }
  const [a, b] = [check(plain), check(inst)]
  if (a !== b) { const A = a.split('\n'), B = b.split('\n'); console.log('plain', A.length, 'inst', B.length); for (const l of A) if (!B.includes(l)) console.log('- ' + l.slice(0, 300)); for (const l of B) if (!A.includes(l)) console.log('+ ' + l.slice(0, 300)) }
  console.log(`typescript: ${files.length} files compiled, ${same} equal outputs, ${differ} different; type check of 2 files: ${a === b ? 'equal' : 'DIFFERENT'} (${a.split('\n').length} diagnostics); ${hit('typescript.cjs')}; load ${loadMs.toFixed(0)} ms`)
}
