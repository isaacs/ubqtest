// Can workerd load TypeScript files from the disk at the time of
// the import, with a real D1 binding? Run: node load.ts
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Miniflare, Response } from 'miniflare'

const t0 = performance.now()
const seen: string[] = []
const mf = new Miniflare({
  unsafeModuleFallbackService(request) {
    const url = new URL(request.url)
    const specifier = url.searchParams.get('specifier') ?? ''
    seen.push(`${request.headers.get('X-Resolve-Method')} ${specifier} raw=${url.searchParams.get('rawSpecifier')}`)
    let source: string
    try {
      source = readFileSync(specifier, 'utf8')
    } catch {
      return new Response(null, { status: 404 })
    }
    if (specifier.endsWith('.ts')) source = stripTypeScriptTypes(source)
    // workerd gives no import.meta.url to these modules.
    source = source
      .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(specifier).href))
      .replaceAll('import.meta.dirname', JSON.stringify(dirname(specifier)))
    return Response.json(specifier.endsWith('.cjs') ? { name: specifier.slice(1), commonJsModule: source } : { name: specifier.slice(1), esModule: source })
  },
  workers: [{
    name: 'test',
    compatibilityDate: '2026-07-01',
    compatibilityFlags: ['nodejs_compat'],
    modulesRoot: '/',
    modules: [{
      type: 'ESModule',
      path: '/entry.mjs',
      contents: `export default { async fetch(request, env) {
        try {
          const file = new URL(request.url).searchParams.get('file')
          process.env.UBQ_CHILD = '1'; process.versions.deno = '0'; process.getActiveResourcesInfo = () => []
          process.env.UBQ_FILE = file
          const dc = await import('node:diagnostics_channel')
          const events = []
          dc.subscribe('ubq.event', e => events.push(e))
          globalThis.__events = events
          const m = await import(new URL(request.url).searchParams.get('file'))
          return Response.json({ result: await m.run(env), events })
        } catch (e) { return new Response(String(e && e.stack || e), { status: 500 }) }
      } }`,
    }],
    unsafeUseModuleFallbackService: true,
    d1Databases: ['DB'],
  }],
})
const file = new URL(process.argv[2] ?? './sample.ts', import.meta.url).pathname
const res = await mf.dispatchFetch(`http://x/?file=${encodeURIComponent(file)}`)
const t1 = performance.now()
console.log(res.status, await res.text())
console.log(seen.join('\n'))
const again = await mf.dispatchFetch(`http://x/?file=${encodeURIComponent(file)}`)
await again.text()
console.log(`first ${(t1 - t0).toFixed(0)} ms, second ${(performance.now() - t1).toFixed(0)} ms`)
await mf.dispose()
