// Times each test tool on the benchmark suite. `docker.sh` runs
// this program in a container with a fixed budget.
//   node run.ts [--runs 10] [--only text] [--json]
// Each row is a command in the project of one tool. The command
// runs one time with no measurement, then `--runs` times. A row
// with a command that fails has no times: a tool that does not run
// the tests is not fast.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'

const here = import.meta.dirname
const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at < 0 ? undefined : process.argv[at + 1]
}
const runs = +(arg('--runs') ?? 10)
const only = arg('--only')
const bin = (name: string): string => join(here, 'node_modules/.bin', name)
const ubq = join(here, 'node_modules/ubqtest/cli.js')
const version = (name: string): string =>
  (JSON.parse(readFileSync(join(here, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version

interface Row {
  group: string
  name: string
  /** The folder of the project in `suite/`. */
  project: string
  command: string[]
  /** A command that runs one time before the others: it writes the snapshots. */
  first?: string[]
  /** True if each run starts with no state of a run before, as a job in CI does. */
  fresh?: boolean
}

const FILE = 'test/text-slug.test.ts'
const c8 = (...command: string[]): string[] => [bin('c8'), '--reporter=text-summary', ...command]
const rows: Row[] = [
  // The command that a project has in its `test` script.
  { group: 'all files', name: 'ubq', project: 'ubq', command: ['node', ubq], first: ['node', ubq, '--update'] },
  { group: 'all files', name: 'ubq, with no state of a run before', project: 'ubq', command: ['node', ubq], fresh: true },
  { group: 'all files', name: 'ubq, with the type check', project: 'ubq-types', command: ['node', ubq], first: ['node', ubq, '--update'] },
  { group: 'all files', name: 'vitest', project: 'vitest', command: [bin('vitest'), 'run'], first: [bin('vitest'), 'run', '-u'] },
  { group: 'all files', name: 'vitest, no isolation', project: 'vitest', command: [bin('vitest'), 'run', '--no-isolate'] },
  { group: 'all files', name: 'ava', project: 'ava', command: [bin('ava')], first: [bin('ava'), '-u'] },
  { group: 'all files', name: 'tape', project: 'tape', command: ['sh', '-c', 'node all.mjs ./test/*.test.ts'] },
  { group: 'all files', name: 'mocha', project: 'mocha', command: [bin('mocha')] },
  { group: 'all files', name: 'mocha, parallel', project: 'mocha', command: [bin('mocha'), '--parallel'] },
  // ubq records coverage in each run. The other tools need an option
  // or a second tool for it.
  { group: 'all files, with coverage', name: 'ubq', project: 'ubq', command: ['node', ubq] },
  { group: 'all files, with coverage', name: 'vitest', project: 'vitest', command: [bin('vitest'), 'run', '--coverage'] },
  { group: 'all files, with coverage', name: 'ava with c8', project: 'ava', command: c8(bin('ava')) },
  { group: 'all files, with coverage', name: 'tape with c8', project: 'tape', command: c8('sh', '-c', 'node all.mjs ./test/*.test.ts') },
  { group: 'all files, with coverage', name: 'mocha with c8', project: 'mocha', command: c8(bin('mocha')) },
  // The time to start: one small file.
  { group: 'one file', name: 'ubq', project: 'ubq', command: ['node', ubq, FILE] },
  { group: 'one file', name: 'ubq, the file as a program', project: 'ubq', command: ['node', FILE] },
  { group: 'one file', name: 'vitest', project: 'vitest', command: [bin('vitest'), 'run', FILE] },
  { group: 'one file', name: 'ava', project: 'ava', command: [bin('ava'), FILE] },
  { group: 'one file', name: 'tape', project: 'tape', command: ['node', FILE] },
  // The config of the project names all files.
  { group: 'one file', name: 'mocha', project: 'mocha', command: [bin('mocha'), '--no-config', FILE] },
].filter(row => !only || `${row.group} ${row.name}`.includes(only))

interface Sample {
  /** Seconds of wall time. */
  wall: number
  /** Seconds of CPU time, of the command and the processes that it started. */
  cpu: number
  /** The most memory of one process of the command, in MB. */
  memory: number
}

const OUT = join(here, '.time')
/** Runs a command with GNU time. Undefined if the command failed, with its output on stderr. */
const run = (row: Row, command: string[], ci = true): Sample | undefined => {
  // The store, and the cache of changed source. The snapshots stay.
  if (row.fresh) rmSync(join(here, 'suite', row.project, '.ubq'), { recursive: true, force: true })
  const start = performance.now()
  const result = spawnSync('/usr/bin/time', ['-f', '%U %S %M', '-o', OUT, ...command], {
    cwd: join(here, 'suite', row.project),
    encoding: 'utf8',
    // As a command in CI: no terminal, and no colors.
    // ava writes no new snapshot in CI, so the first command is not in CI.
    env: { ...process.env, ...(ci && { CI: '1' }), NO_COLOR: '1', FORCE_COLOR: '0' },
  })
  const wall = (performance.now() - start) / 1000
  if (result.status !== 0) {
    process.stderr.write(
      `FAILED ${row.group} > ${row.name}: exit code ${result.status}\n${(result.stdout + result.stderr).split('\n').slice(-30).join('\n')}\n`,
    )
    return undefined
  }
  const [user = 0, system = 0, kb = 0] = readFileSync(OUT, 'utf8').trim().split('\n').at(-1)!.split(' ').map(Number)
  return { wall, cpu: user + system, memory: kb / 1024 }
}

const median = (list: number[]): number => {
  const sorted = list.toSorted((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

const results: Record<string, unknown>[] = []
for (const row of rows) {
  // The state of a run before must not help this one.
  if (row.first) for (const dir of ['.ubq', 'coverage']) rmSync(join(here, 'suite', row.project, dir), { recursive: true, force: true })
  const ready = (!row.first || run(row, row.first, false)) && run(row, row.command)
  const samples = ready ? Array.from({ length: runs }, () => run(row, row.command)) : []
  const good = samples.filter(sample => sample !== undefined)
  const failed = !ready || good.length < samples.length
  results.push({
    group: row.group,
    name: row.name,
    ...(failed
      ? { failed: true }
      : {
          'wall s, median': +median(good.map(s => s.wall)).toFixed(2),
          'wall s, min': +Math.min(...good.map(s => s.wall)).toFixed(2),
          'wall s, max': +Math.max(...good.map(s => s.wall)).toFixed(2),
          'cpu s, median': +median(good.map(s => s.cpu)).toFixed(2),
          'memory MB': Math.round(median(good.map(s => s.memory))),
        }),
  })
  process.stderr.write(`done: ${row.group} > ${row.name}\n`)
}
if (existsSync(OUT)) rmSync(OUT)

const about = {
  node: process.version,
  cpus: process.env.BENCH_CPUS ?? String(availableParallelism()),
  memory: process.env.BENCH_MEMORY ?? 'no limit',
  runs,
  versions: Object.fromEntries(['ubqtest', 'vitest', 'ava', 'tape', 'mocha', 'c8', 'typescript'].map(name => [name, version(name)])),
}
if (process.argv.includes('--json')) console.log(JSON.stringify({ about, results }, null, 2))
else {
  console.log(`Node ${about.node}, ${about.cpus} CPUs, ${about.memory} of memory, ${runs} runs of each command`)
  console.log(Object.entries(about.versions).map(([name, v]) => `${name} ${v}`).join(', '))
  for (const group of new Set(results.map(result => result.group))) {
    console.log(`\n${group as string}`)
    console.table(
      Object.fromEntries(
        results
          .filter(result => result.group === group)
          .map(({ name, group: _, ...rest }) => [name, rest]),
      ),
    )
  }
}
// A row that failed is a fault of the benchmark.
process.exit(results.some(result => result.failed) ? 1 : 0)
