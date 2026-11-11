// Does bun:jsc give coverage data to a plain program?
import { codeCoverageForFile } from 'bun:jsc'
import { readFileSync } from 'node:fs'
import { pick } from './src.ts'
const path = new URL('./src.ts', import.meta.url).pathname
const src = readFileSync(path, 'utf8')
console.log('arity', codeCoverageForFile.length)
const show = (label: string) => {
  for (const args of [[path], [path, src], [path, src, true], [path, src, true, true]] as any[]) {
    try { const r = (codeCoverageForFile as any)(...args); console.log(label, args.length, 'args ->', JSON.stringify(r)?.slice(0, 400)) } catch (e: any) { console.log(label, args.length, 'args -> throws', e.message) }
  }
}
show('before')
pick(0, null)
show('after1')
pick(5, null)
show('after2')
