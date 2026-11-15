// Evals: do coding agents write correct code and strong tests with
// ubq? Each task is a small project, a prompt, and hidden tests that
// the agent does not see. The harness gives the task to an agent in
// a new folder, then grades the folder. See README.md.
//
//   node evals/run.ts [--agent good|cheat|claude:<model>]... [--task <name>]...
//                     [--setup none|claude-md|skill]... [--runs <n>] [--budget <usd>] [--keep]
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '..')

const { values } = parseArgs({
  options: {
    agent: { type: 'string', multiple: true, default: ['good', 'cheat'] },
    task: { type: 'string', multiple: true },
    setup: { type: 'string', multiple: true, default: ['skill'] },
    runs: { type: 'string', default: '1' },
    budget: { type: 'string', default: '1' },
    keep: { type: 'boolean', default: false },
  },
})

/** What the project tells the agent about ubq, as README.md suggests. */
const CLAUDE_MD = `Tests use ubq (the ubqtest package). Before you write or run
tests, read \`npx ubq guide\`. Run \`npx ubq --changed\` after a
change, then \`npx ubq uncovered --diff\`. Before you say that the
work is done, run \`npx ubq check\`, and report each item of \`npx
ubq review\`.
`

/** The tools that the agent may use with no prompt. Nothing outside the folder of the task. */
const TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Skill',
  'Bash(npx ubq:*)',
  'Bash(npm test:*)',
  'Bash(npm run test:update:*)',
  'Bash(node:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(git diff:*)',
  'Bash(git status:*)',
]

// The package, built once, as a project installs it.
const pkg = join(here, '.build', 'ubqtest')
const build = spawnSync(process.execPath, ['scripts/build.ts', pkg], { cwd: root, encoding: 'utf8' })
if (build.status) throw new Error(`the build failed:\n${build.stderr}`)
const cli = join(pkg, 'cli.js')

// The environment of ubq in the folder of a task: no variables of
// this session's runs.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('UBQ_') && name !== 'CI'),
)

interface Run {
  code: number | null
  out: string
}
const sh = (cwd: string, cmd: string, args: string[], timeout = 300_000): Run => {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 1 << 26 })
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}
const ubq = (cwd: string, ...args: string[]): Run => sh(cwd, process.execPath, [cli, ...args])
const git = (cwd: string, ...args: string[]): Run =>
  sh(cwd, 'git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.com', '-c', 'commit.gpgsign=false', ...args])

/** A new folder with the project of a task, in git, set up as `setup` says. */
const prepare = (task: string, setup: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `ubq-eval-${task}-`))
  cpSync(join(here, 'tasks', task, 'project'), dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      { type: 'module', scripts: { test: 'ubq', 'test:update': 'ubq' }, devDependencies: { ubqtest: '*' } },
      null,
      2,
    ) + '\n',
  )
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true })
  cpSync(pkg, join(dir, 'node_modules', 'ubqtest'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', '.bin', 'ubq'), `#!/bin/sh\nexec node "${join(dir, 'node_modules', 'ubqtest', 'cli.js')}" "$@"\n`, {
    mode: 0o755,
  })
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n.ubq\n')
  if (setup !== 'none') writeFileSync(join(dir, 'CLAUDE.md'), CLAUDE_MD)
  if (setup === 'skill') ubq(dir, 'skill', 'claude')
  git(dir, 'init', '-q')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'the task')
  return dir
}

interface AgentResult {
  turns?: number
  cost?: number
  ms: number
  /** The last message of the agent. */
  said?: string
  error?: string
}

/** Gives the task to an agent in `dir`. */
const work = (agent: string, task: string, dir: string): AgentResult => {
  const t0 = Date.now()
  if (agent === 'good' || agent === 'cheat') {
    // A scripted agent: the files of a solution, then a run of the tests.
    cpSync(join(here, 'tasks', task, 'solutions', agent), dir, { recursive: true })
    ubq(dir)
    return { ms: Date.now() - t0 }
  }
  const model = /^claude:(.+)$/.exec(agent)?.[1]
  if (!model) throw new Error(`unknown agent: ${agent}. The agents are good, cheat, and claude:<model>`)
  const prompt = readFileSync(join(here, 'tasks', task, 'task.md'), 'utf8')
  const r = sh(
    dir,
    'claude',
    [
      '-p',
      prompt,
      '--model',
      model,
      '--output-format',
      'json',
      '--setting-sources',
      'project',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--max-budget-usd',
      values.budget!,
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      ...TOOLS,
    ],
    900_000,
  )
  try {
    const json = JSON.parse(r.out.slice(r.out.indexOf('{'))) as {
      num_turns: number
      total_cost_usd: number
      result?: string
      is_error?: boolean
      subtype?: string
    }
    return {
      turns: json.num_turns,
      cost: json.total_cost_usd,
      ms: Date.now() - t0,
      said: json.result,
      ...(json.is_error && { error: json.subtype ?? 'error' }),
    }
  } catch {
    return { ms: Date.now() - t0, error: `no result (exit ${r.code}): ${r.out.slice(0, 300)}` }
  }
}

/** The counts of the summary line of a run: `fail: 1 failed, 3 passed (run 2)`. */
const counts = (out: string): { failed: number; passed: number } => {
  const m = /^(?:pass|fail): (?:(\d+) errors, )?(\d+) failed, (\d+) passed/m.exec(out)
  return m ? { failed: +(m[1] ?? 0) + +m[2]!, passed: +m[3]! } : { failed: 0, passed: 0 }
}

interface Grade {
  /** The hidden tests: the code does what the task asked. */
  hidden: { passed: number; total: number }
  /** The tests of the project, as the agent left them. */
  own: { passed: number; failed: number }
  /** `ubq check` passed: the agent left results that are current and pass. */
  check: boolean
  /** Items of `ubq review`: removed, skipped, or weaker tests. */
  review: number
  /** Changes of `ubq mutate` that the tests of the agent kill. */
  mutation: { killed: number; total: number }
}

/** Grades the folder that the agent left. The order matters: each step can add runs to the store. */
const grade = (task: string, dir: string): Grade => {
  const { target } = JSON.parse(readFileSync(join(here, 'tasks', task, 'eval.json'), 'utf8')) as { target: string }
  const check = ubq(dir, 'check').code === 0
  const review = Number(/^review: (\d+) changes/m.exec(ubq(dir, 'review').out)?.[1] ?? 0)
  const own = counts(ubq(dir).out)
  const m = /^mutate: (\d+) of (\d+) changes survived/m.exec(ubq(dir, 'mutate', target).out)
  const mutation = m ? { killed: +m[2]! - +m[1]!, total: +m[2]! } : { killed: 0, total: 0 }
  cpSync(join(here, 'tasks', task, 'hidden'), join(dir, 'hidden'), { recursive: true })
  const h = counts(ubq(dir, 'hidden').out)
  return { hidden: { passed: h.passed, total: h.passed + h.failed }, own, check, review, mutation }
}

const tasks = values.task ?? readdirSync(join(here, 'tasks')).sort()
const rows: (Grade & AgentResult & { task: string; agent: string; setup: string; dir?: string })[] = []
for (const task of tasks)
  for (const agent of values.agent!)
    for (const setup of values.setup!)
      for (let i = 0; i < +values.runs!; i++) {
        const dir = prepare(task, setup)
        process.stderr.write(`${task}, ${agent}, ${setup}: ${dir}\n`)
        const result = work(agent, task, dir)
        rows.push({ task, agent, setup, ...result, ...grade(task, dir), ...(values.keep && { dir }) })
        if (!values.keep) rmSync(dir, { recursive: true, force: true })
      }

// The table, and the rows as JSON for a later comparison.
const cell = (n: number, of: number): string => `${n}/${of}`
const table = [
  '| task | agent | setup | hidden | own tests | check | review | mutation | false green | turns | cost | time |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map(r =>
    [
      r.task,
      r.agent,
      r.setup,
      cell(r.hidden.passed, r.hidden.total),
      `${r.own.passed} pass, ${r.own.failed} fail`,
      r.check ? 'pass' : 'FAIL',
      r.review,
      cell(r.mutation.killed, r.mutation.total),
      r.own.failed === 0 && r.hidden.passed < r.hidden.total ? 'YES' : '',
      r.turns ?? '',
      r.cost === undefined ? '' : `$${r.cost.toFixed(3)}`,
      `${(r.ms / 1000).toFixed(0)} s`,
    ].join(' | '),
  ).map(line => `| ${line} |`),
].join('\n')
process.stdout.write(table + '\n')
for (const r of rows) if (r.error) process.stdout.write(`error: ${r.task}, ${r.agent}, ${r.setup}: ${r.error}\n`)
const results = join(here, 'results')
if (!existsSync(results)) mkdirSync(results)
const file = join(results, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(file, JSON.stringify(rows, null, 2) + '\n')
process.stdout.write(`results: ${file}\n`)
