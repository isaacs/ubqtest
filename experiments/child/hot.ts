// Work in code of the project: the parser reads each source file 3 times.
import { readdirSync, readFileSync } from 'node:fs'
import { instrument } from '../../src/instrument.ts'
const dir = new URL('../../src/', import.meta.url)
let n = 0
for (let i = 0; i < 3; i++)
  for (const name of readdirSync(dir)) if (name.endsWith('.ts') && !name.endsWith('.d.ts')) n += instrument(readFileSync(new URL(name, dir), 'utf8'), name)?.regions.length ?? 0
console.log(n)
