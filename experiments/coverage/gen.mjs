// Generate a synthetic codebase: N modules, each with M functions.
// usage: node gen.mjs <dir> <modules> <fnsPerModule>
import { mkdirSync, writeFileSync } from 'node:fs'
const [dir, N, M] = [process.argv[2], +process.argv[3], +process.argv[4]]
mkdirSync(dir, { recursive: true })
for (let i = 0; i < N; i++) {
  let s = ''
  for (let j = 0; j < M; j++) {
    s += `export function f${j}(a, b) {
  let t = 0
  if (a > b) { t = a - b } else { t = b - a }
  for (let i = 0; i < 3; i++) { t += i % 2 ? a : b }
  return a && b ? t : t + 1
}
`
  }
  writeFileSync(`${dir}/m${i}.mjs`, s)
}
let idx = ''
for (let i = 0; i < N; i++) idx += `export * as m${i} from './m${i}.mjs'\n`
writeFileSync(`${dir}/index.mjs`, idx)
