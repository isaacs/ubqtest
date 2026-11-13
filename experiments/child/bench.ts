// What does coverage of a child process cost? Run from the
// repository root: node experiments/child/bench.ts [runs]
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const runs = +(process.argv[2] ?? 20)
const here = fileURLToPath(new URL('.', import.meta.url))
const root = fileURLToPath(new URL('../..', import.meta.url))
const preload = pathToFileURL(join(here, 'preload.ts')).href
const work: Record<string, string[]> = {
  'a script of one line': [join(here, 'tiny.mjs')],
  'ubq help (35 project files load)': [join(root, 'src/cli.ts'), 'help'],
  'the parser on 150 files (work in project code)': [join(here, 'hot.ts')],
}
const { NODE_OPTIONS: _, NODE_V8_COVERAGE: __, ...clean } = process.env
for (const [name, args] of Object.entries(work)) {
  const row: string[] = []
  for (const mode of ['none', 'v8', 'counters'] as const) {
    const dir = mkdtempSync(join(tmpdir(), 'ubq-child-'))
    const env =
      mode === 'v8' ? { ...clean, NODE_V8_COVERAGE: dir }
      : mode === 'counters' ? { ...clean, NODE_OPTIONS: `--import ${preload}`, UBQ_CHILD_DIR: dir }
      : clean
    // One run first: the caches of the runtime and of the counters.
    spawnSync(process.execPath, args, { cwd: root, env })
    const t0 = performance.now()
    for (let i = 0; i < runs; i++) {
      const r = spawnSync(process.execPath, args, { cwd: root, env })
      if (r.status !== 0) throw new Error(`${name} (${mode}): ${r.stderr}`)
    }
    const ms = (performance.now() - t0) / runs
    const files = readdirSync(dir)
    const bytes = files.reduce((sum, f) => sum + statSync(join(dir, f)).size, 0) / Math.max(1, files.length)
    // The parent must read what the child wrote.
    const r0 = performance.now()
    for (const f of files) JSON.parse(readFileSync(join(dir, f), 'utf8'))
    const read = (performance.now() - r0) / Math.max(1, files.length)
    row.push(`${mode} ${ms.toFixed(0)} ms${files.length ? ` (${(bytes / 1024).toFixed(0)} kB, read ${read.toFixed(1)} ms)` : ''}`)
    rmSync(dir, { recursive: true })
  }
  console.log(`${name}: ${row.join(' | ')}`)
}
