// Robustness of the instrumenter on real code.
// For each file: does the parser read it, and does the changed
// source parse again with each line in place?
// usage: node corpus.ts <dir>...
import { tsPlugin } from '@sveltejs/acorn-typescript'
import { Parser } from 'acorn'
import { globSync, readFileSync } from 'node:fs'
import { instrument } from '../../src/instrument.ts'

const ts = Parser.extend(tsPlugin() as never)
const reasons = new Map<string, string[]>()
let files = 0, bytes = 0, ok = 0, unread = 0, broken = 0, ms = 0
for (const dir of process.argv.slice(2)) {
  for (const f of globSync('**/*.{js,mjs,cjs,ts,mts,cts}', { cwd: dir, exclude: p => /(^|\/)\.git$/.test(p) })) {
    if (f.endsWith('.d.ts') || f.endsWith('.min.js')) continue
    let src: string
    try { src = readFileSync(`${dir}/${f}`, 'utf8') } catch { continue }
    files++; bytes += src.length
    const t = performance.now()
    const r = instrument(src, f)
    ms += performance.now() - t
    if (!r) {
      unread++
      let why = 'unknown'
      try { ts.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true }) } catch (e) { why = (e as Error).message.replace(/ \(\d+:\d+\)$/, '') }
      reasons.set(why, [...(reasons.get(why) ?? []), `${dir}/${f}`])
      continue
    }
    try {
      ts.parse(r.code, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true })
      if (r.code.split('\n').length !== src.split('\n').length) throw new Error('line count changed')
      ok++
    } catch (e) {
      broken++
      console.log('BROKEN OUTPUT', `${dir}/${f}`, (e as Error).message)
    }
  }
}
console.log({ files, mb: +(bytes / 1e6).toFixed(1), ok, unread, broken, parseAndChangeMs: Math.round(ms), mbPerSecond: +(bytes / 1e6 / (ms / 1000)).toFixed(1) })
for (const [why, list] of [...reasons].sort((a, b) => b[1].length - a[1].length).slice(0, 12)) console.log(String(list.length).padStart(5), why, '  e.g.', list[0])
