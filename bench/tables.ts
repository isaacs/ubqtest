// Writes the tables of `README.md` from the files in `results/`:
// the text between the two `results` comments.
//   node tables.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Result {
  group: string
  name: string
  'wall s, median': number
  'cpu s, median': number
  'memory MB': number
}
interface Run {
  about: { node: string; versions: Record<string, string> }
  results: Result[]
}
const here = import.meta.dirname
const load = (name: string): Run => JSON.parse(readFileSync(join(here, 'results', `${name}.json`), 'utf8')) as Run
const [small, large] = [load('2cpu-2g'), load('4cpu-4g')]

const TITLES: Record<string, string> = {
  'all files': 'All 20 files',
  'all files, with coverage': 'All 20 files, with coverage',
  'one file': 'One file (21 tests, 210 plain assertions)',
}
const cells = (r: Result): string => `${r['wall s, median'].toFixed(2)} | ${r['cpu s, median'].toFixed(2)} | ${r['memory MB']}`
const table = (group: string): string =>
  [
    `### ${TITLES[group]}`,
    '',
    '| Command | 2 CPUs, 2 GB: wall s | CPU s | MB | 4 CPUs, 4 GB: wall s | CPU s | MB |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...small.results
      .filter(r => r.group === group)
      .map(r => `| ${r.name} | ${cells(r)} | ${cells(large.results.find(o => o.group === group && o.name === r.name)!)} |`),
  ].join('\n')

const versions = Object.entries(small.about.versions)
  .filter(([name]) => name !== 'typescript')
  .map(([name, version]) => `${name} ${version}`)
  .join(', ')
const text = [`Node ${small.about.node}. ${versions}.`, ...Object.keys(TITLES).map(table)].join('\n\n')
const file = join(here, 'README.md')
const readme = readFileSync(file, 'utf8')
const [start, end] = ['<!-- results -->', '<!-- /results -->']
if (!readme.includes(start) || !readme.includes(end)) throw new Error(`README.md has no ${start} and ${end}`)
writeFileSync(file, `${readme.slice(0, readme.indexOf(start) + start.length)}\n${text}\n${readme.slice(readme.indexOf(end))}`)
