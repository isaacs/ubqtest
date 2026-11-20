// Writes an SVG bar chart of the lines in the repository, by part,
// to stdout: `node scripts/lines.ts > lines.svg`. It counts each line
// of each file that git tracks, with comments and blank lines.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

type Group = 'Code' | 'Tests' | 'Docs' | 'Other'
type Part = { name: string; group: Group; has: (file: string) => boolean }

const set =
  (...files: string[]) =>
  (file: string) =>
    files.includes(file)
const API = set(
  ...['index', 'any', 'assert', 'format', 'spy', 'mock', 'clock', 'fixtures', 'snapshot', 'test', 'hint']
    .concat(['browser', 'workers'])
    .map(name => `src/${name}.ts`),
)
const CONVERTER = set('src/convert.ts', 'src/convert-restore.ts', 'src/vitest-config.ts')
const GUIDES = set(
  'GUIDE.md',
  'CONVERT.md',
  'skills/use-ubq/SKILL.md',
  'docs/api.md',
  'docs/08-config.md',
  'docs/store.md',
)

// The first part that has a file gets it.
const PARTS: Part[] = [
  { name: 'Test API', group: 'Code', has: API },
  { name: 'Converter', group: 'Code', has: CONVERTER },
  { name: 'Runner and CLI', group: 'Code', has: file => file.startsWith('src/') },
  { name: 'Tests (of ubq itself)', group: 'Tests', has: file => file.startsWith('test/') },
  { name: 'Guides for agents', group: 'Docs', has: GUIDES },
  { name: 'Feedback reports', group: 'Docs', has: file => /^docs\/(1[2-9]|[2-9]\d)-/.test(file) },
  { name: 'Docs for people', group: 'Docs', has: file => file === 'README.md' || file.startsWith('docs/') },
  { name: 'Tools, site, and config', group: 'Other', has: () => true },
]

// Files that are not text that a person writes.
const SKIP = /(^private\/|package-lock\.json$|\.(png|ico)$|^bench\/results\/)/

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(file => file && !SKIP.test(file))
const lines = new Map(PARTS.map(part => [part, 0]))
for (const file of files) {
  const part = PARTS.find(p => p.has(file))!
  const text = readFileSync(file, 'utf8')
  lines.set(part, lines.get(part)! + text.split('\n').length - (text.endsWith('\n') ? 1 : 0))
}
const total = [...lines.values()].reduce((a, b) => a + b, 0)
const version = JSON.parse(readFileSync('package.json', 'utf8')).version

// The categorical colors of the chart, for a light and a dark surface.
const COLORS: Record<Group, [string, string]> = {
  Code: ['#2a78d6', '#3987e5'],
  Tests: ['#eb6834', '#d95926'],
  Docs: ['#1baf7a', '#199e70'],
  Other: ['#eda100', '#c98500'],
}
const GROUPS = Object.keys(COLORS) as Group[]

const WIDTH = 720
const LABEL = 190
const BAR = 380
const ROW = 30
const TOP = 96
const max = Math.max(...lines.values())
const n = (value: number) => value.toLocaleString('en-US')
const rows = PARTS.toSorted((a, b) => lines.get(b)! - lines.get(a)!).map((part, i) => {
  const y = TOP + i * ROW
  const count = lines.get(part)!
  const w = Math.max(2, (count / max) * BAR)
  const pct = Math.round((count / total) * 100)
  return `  <text class="label" x="${LABEL - 12}" y="${y + 15}" text-anchor="end">${part.name}</text>
  <rect class="${part.group}" x="${LABEL}" y="${y + 4}" width="${w.toFixed(1)}" height="16" rx="3"><title>${part.name}: ${n(count)} lines</title></rect>
  <text class="value" x="${LABEL + w + 8}" y="${y + 15}">${n(count)} <tspan class="muted">${pct}%</tspan></text>`
})
let x = 0
const legend = GROUPS.map(group => {
  const item = `  <rect class="${group}" x="${x}" y="54" width="12" height="12" rx="2"/>
  <text class="muted" x="${x + 18}" y="64">${group}</text>`
  x += 18 + group.length * 7 + 24
  return item
})
const height = TOP + PARTS.length * ROW + 16
const css = (dark: 0 | 1) => GROUPS.map(group => `.${group}{fill:${COLORS[group][dark]}}`).join('')

process.stdout
  .write(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" font-family="system-ui, -apple-system, sans-serif" font-size="13">
<style>
text{fill:#0b0b0b}.muted{fill:#52514e}.bg{fill:#fcfcfb}
.title{font-size:16px;font-weight:600}.value{font-variant-numeric:tabular-nums}
${css(0)}
@media (prefers-color-scheme: dark){text{fill:#f0efec}.muted{fill:#c3c2b7}.bg{fill:#1a1a19}${css(1)}}
</style>
<rect class="bg" width="100%" height="100%" rx="6"/>
<g transform="translate(16 0)">
  <text class="title" x="0" y="26">Lines in ubqtest ${version}, by part</text>
  <text class="muted" x="0" y="44">${n(total)} lines in ${n(files.length)} files. Each line counts: code, comments, and blank lines.</text>
${legend.join('\n')}
${rows.join('\n')}
</g>
</svg>
`)
