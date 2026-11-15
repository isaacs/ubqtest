// Evals: do coding agents write correct code and strong tests, with
// ubq and with other test tools? Each task is a small project, a
// prompt, and hidden tests that the agent does not see. The harness
// gives the task to an agent in a new folder, then grades the
// folder. See README.md.
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '..')
const list = (name: string, fallback: string): string[] => (process.env[name] || fallback).split(',')

const { values } = parseArgs({
  options: {
    agent: { type: 'string', multiple: true, default: list('EVAL_AGENTS', 'claude') },
    model: { type: 'string', multiple: true, default: list('EVAL_MODELS', 'haiku') },
    task: { type: 'string', multiple: true },
    framework: { type: 'string', multiple: true, default: list('EVAL_FRAMEWORKS', 'ubq,vitest,node-test') },
    setup: { type: 'string', multiple: true, default: list('EVAL_SETUPS', 'skill') },
    runs: { type: 'string', default: process.env.EVAL_RUNS || '1' },
    budget: { type: 'string', default: process.env.EVAL_BUDGET || '0.5' },
    keep: { type: 'boolean', default: false },
  },
})

const FRAMEWORKS = ['ubq', 'vitest', 'node-test'] as const
type Framework = (typeof FRAMEWORKS)[number]
for (const f of values.framework!)
  if (!FRAMEWORKS.includes(f as Framework))
    throw new Error(`unknown framework: ${f}. They are: ${FRAMEWORKS.join(', ')}`)

/** What a project of each test tool has in package.json. */
const PACKAGE: Record<Framework, object> = {
  ubq: { scripts: { test: 'ubq', 'test:update': 'ubq' }, devDependencies: { ubqtest: '*' } },
  vitest: { scripts: { test: 'vitest run' }, devDependencies: { vitest: '*' } },
  'node-test': { scripts: { test: 'node --test "test/**/*.test.ts"' } },
}

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
  'Bash(npx vitest:*)',
  'Bash(npm test:*)',
  'Bash(npm run:*)',
  'Bash(node:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(git diff:*)',
  'Bash(git status:*)',
]

// The environment of the commands in the folder of a task: no
// variables of the runs of this session.
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => !name.startsWith('UBQ_') && name !== 'CI' && !name.startsWith('VITEST'),
  ),
)

interface Run {
  code: number | null
  out: string
}
const sh = (cwd: string, cmd: string, args: string[], timeout = 120_000): Run => {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 1 << 26, killSignal: 'SIGKILL' })
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

// The package, built once, as a project installs it. The other test
// tools, installed once.
const build = join(here, '.build')
const pkg = join(build, 'ubqtest')
const made = spawnSync(process.execPath, ['scripts/build.ts', pkg], { cwd: root, encoding: 'utf8' })
if (made.status) throw new Error(`the build failed:\n${made.stderr}`)
const deps = join(build, 'deps')
if (values.framework!.includes('vitest') && !existsSync(join(deps, 'node_modules', 'vitest'))) {
  mkdirSync(deps, { recursive: true })
  writeFileSync(join(deps, 'package.json'), '{ "private": true }\n')
  const r = sh(deps, 'npm', ['install', '--no-audit', '--no-fund', 'vitest'], 600_000)
  if (r.code) throw new Error(`npm install vitest failed:\n${r.out}`)
}
const vitestVersion = existsSync(join(deps, 'node_modules', 'vitest'))
  ? (JSON.parse(readFileSync(join(deps, 'node_modules', 'vitest', 'package.json'), 'utf8')) as { version: string })
      .version
  : undefined
const { mutants } = createRequire(import.meta.url)(join(pkg, 'instrument.js')) as typeof import('../src/instrument.ts')

const ubq = (cwd: string, ...args: string[]): Run =>
  sh(cwd, process.execPath, [join(cwd, 'node_modules', 'ubqtest', 'cli.js'), ...args])
const git = (cwd: string, ...args: string[]): Run =>
  sh(cwd, 'git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.com', '-c', 'commit.gpgsign=false', ...args])

/** A check of a test, in a form of no test tool. */
type Check = ['equal' | 'deepEqual' | 'throws' | 'rejects', string, string] | ['ok', string]
/** Tests, in a form of no test tool: a task has its tests in this form, and so does a scripted solution. */
interface Spec {
  file: string
  imports: Record<string, string[]>
  tests: { name: string; checks: Check[] }[]
}

/** The test file of a spec, for a test tool. */
const testFile = (spec: Spec, fw: Framework): string => {
  const head = {
    ubq: ["import { assert, test } from 'ubqtest'"],
    vitest: ["import { expect, test } from 'vitest'"],
    'node-test': ["import assert from 'node:assert/strict'", "import { test } from 'node:test'"],
  }[fw]
  const imports = Object.entries(spec.imports).map(([from, names]) => `import { ${names.join(', ')} } from '${from}'`)
  const line = ([kind, a, b]: Check): string => {
    if (fw === 'vitest')
      return {
        equal: `expect(${a}).toBe(${b})`,
        deepEqual: `expect(${a}).toEqual(${b})`,
        throws: `expect(${a}).toThrow(${b})`,
        rejects: `await expect(${a}).rejects.toThrow(${b})`,
        ok: `expect(${a}).toBeTruthy()`,
      }[kind]
    return {
      equal: `assert.equal(${a}, ${b})`,
      deepEqual: `assert.deepEqual(${a}, ${b})`,
      throws: `assert.throws(${a}, ${b})`,
      rejects: `await assert.rejects(${a}, ${b})`,
      ok: fw === 'ubq' ? `assert(${a})` : `assert.ok(${a})`,
    }[kind]
  }
  const tests = spec.tests.map(t => {
    const lines = t.checks.map(line)
    const async = lines.some(l => l.includes('await')) ? 'async ' : ''
    return `\ntest(${JSON.stringify(t.name).replace(/^"|"$/g, "'")}, ${async}() => {\n${lines.map(l => `  ${l}\n`).join('')}})\n`
  })
  return [...head, ...imports].join('\n') + '\n' + tests.join('')
}

const specOf = (path: string): Spec | undefined =>
  existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Spec) : undefined

/** Links each package of `from` into the `node_modules` of `dir`. */
const linkModules = (from: string, dir: string): void => {
  const modules = join(dir, 'node_modules')
  mkdirSync(join(modules, '.bin'), { recursive: true })
  for (const name of readdirSync(join(from, 'node_modules')))
    if (name !== '.bin' && !name.startsWith('.')) symlinkSync(join(from, 'node_modules', name), join(modules, name))
  for (const name of readdirSync(join(from, 'node_modules', '.bin')))
    symlinkSync(realpathSync(join(from, 'node_modules', '.bin', name)), join(modules, '.bin', name))
}

/** Puts ubq in the `node_modules` of `dir`, with its command. */
const addUbq = (dir: string): void => {
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true })
  cpSync(pkg, join(dir, 'node_modules', 'ubqtest'), { recursive: true })
  writeFileSync(
    join(dir, 'node_modules', '.bin', 'ubq'),
    `#!/bin/sh\nexec node "${join(dir, 'node_modules', 'ubqtest', 'cli.js')}" "$@"\n`,
    { mode: 0o755 },
  )
}

/** A new folder with the project of a task for a test tool, in git, set up as `setup` says. */
const prepare = (task: string, fw: Framework, setup: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `ubq-eval-${task}-${fw}-`))
  cpSync(join(here, 'tasks', task, 'project'), dir, { recursive: true })
  const spec = specOf(join(here, 'tasks', task, 'tests.json'))!
  mkdirSync(join(dir, 'test'), { recursive: true })
  writeFileSync(join(dir, spec.file), testFile(spec, fw))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', ...PACKAGE[fw] }, null, 2) + '\n')
  if (fw === 'ubq') addUbq(dir)
  if (fw === 'vitest') linkModules(deps, dir)
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n.ubq\n')
  if (fw === 'ubq' && setup !== 'none') writeFileSync(join(dir, 'CLAUDE.md'), CLAUDE_MD)
  if (fw === 'ubq' && setup === 'skill') ubq(dir, 'skill', 'claude')
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
const work = (agent: string, task: string, fw: Framework, dir: string): AgentResult => {
  const t0 = Date.now()
  // An agent that does nothing: the grades of the task as it is.
  if (agent === 'none') return { ms: 0 }
  if (agent === 'good' || agent === 'cheat') {
    // A scripted agent: the files of a solution, its tests in the form
    // of the test tool, then a run of the tests.
    const solution = join(here, 'tasks', task, 'solutions', agent)
    cpSync(solution, dir, { recursive: true, filter: path => !path.endsWith('tests.json') })
    const spec = specOf(join(solution, 'tests.json'))
    if (spec) writeFileSync(join(dir, spec.file), testFile(spec, fw))
    sh(dir, 'npm', ['test'])
    return { ms: Date.now() - t0 }
  }
  const model = /^claude:(.+)$/.exec(agent)?.[1]
  if (!model) throw new Error(`unknown agent: ${agent}. The agents are claude, none, good, and cheat`)
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
    1_200_000,
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

/** The counts of the summary line of a run of ubq: `fail: 1 failed, 3 passed (run 2)`. */
const counts = (out: string): { failed: number; passed: number } => {
  const m = /^(?:pass|fail): (?:(\d+) errors, )?(\d+) failed, (\d+) passed/m.exec(out)
  return m ? { failed: +(m[1] ?? 0) + +m[2]!, passed: +m[3]! } : { failed: 0, passed: 0 }
}

/** The most changes of the mutation check of a task. */
const MUTANTS = 30

interface Grade {
  /** The hidden tests, run with ubq: the code does what the task asked. */
  hidden: { passed: number; total: number }
  /** `npm test` passed, in its time limit, as the agent left the project. */
  green: boolean
  /** ubq only: `ubq check` passed. The results are current, and pass. */
  check?: boolean
  /** ubq only: items of `ubq review`: removed, skipped, or weaker tests. */
  review?: number
  /** Small changes to the target that make `npm test` fail. */
  mutation: { killed: number; total: number }
  /** Lines with an assertion that the agent removed or changed in the test file of the task. */
  removed: number
}

/** Grades the folder that the agent left. The order matters: each step can add runs to the store. */
const grade = (task: string, fw: Framework, dir: string): Grade => {
  const { target } = JSON.parse(readFileSync(join(here, 'tasks', task, 'eval.json'), 'utf8')) as { target: string }
  const spec = specOf(join(here, 'tasks', task, 'tests.json'))!
  const check = fw === 'ubq' ? ubq(dir, 'check').code === 0 : undefined
  const review = fw === 'ubq' ? Number(/^review: (\d+) changes/m.exec(ubq(dir, 'review').out)?.[1] ?? 0) : undefined
  const removed = git(dir, 'diff', '-U0', 'HEAD', '--', spec.file)
    .out.split('\n')
    .filter(l => l.startsWith('-') && !l.startsWith('---') && /assert|expect\(/.test(l)).length
  const green = sh(dir, 'npm', ['test'], 60_000).code === 0
  // The mutation check, with the test command of the project: the
  // same for each test tool.
  const path = join(dir, target)
  const source = readFileSync(path, 'utf8')
  const all = (mutants(source, target) ?? []).slice(0, MUTANTS)
  let killed = 0
  for (const m of all) {
    writeFileSync(path, source.slice(0, m.start) + m.text + source.slice(m.end))
    if (sh(dir, 'npm', ['test'], 30_000).code !== 0) killed++
  }
  writeFileSync(path, source)
  // The hidden tests, with ubq for each test tool: they import only
  // the source.
  if (!existsSync(join(dir, 'node_modules', 'ubqtest'))) addUbq(dir)
  cpSync(join(here, 'tasks', task, 'hidden'), join(dir, 'hidden'), { recursive: true })
  const h = counts(ubq(dir, 'hidden').out)
  return {
    hidden: { passed: h.passed, total: h.passed + h.failed },
    green,
    ...(check !== undefined && { check }),
    ...(review !== undefined && { review }),
    mutation: { killed, total: all.length },
    removed,
  }
}

type Row = Grade & AgentResult & { task: string; framework: Framework; agent: string; setup: string; dir?: string }

const tasks = values.task ?? readdirSync(join(here, 'tasks')).sort()
const agents = values.agent!.flatMap(a => (a === 'claude' ? values.model!.map(m => `claude:${m}`) : [a]))
const rows: Row[] = []
for (const task of tasks)
  for (const fw of values.framework! as Framework[])
    for (const agent of agents)
      // The setups are ways to tell an agent about ubq.
      for (const setup of fw === 'ubq' ? values.setup! : ['-'])
        for (let i = 0; i < +values.runs!; i++) {
          const dir = prepare(task, fw, setup)
          process.stderr.write(`${task}, ${fw}, ${agent}, ${setup}: ${dir}\n`)
          const result = work(agent, task, fw, dir)
          rows.push({
            task,
            framework: fw,
            agent,
            setup,
            ...result,
            ...grade(task, fw, dir),
            ...(values.keep && { dir }),
          })
          if (!values.keep) rmSync(dir, { recursive: true, force: true })
        }

const solved = (r: Row): boolean => r.hidden.total > 0 && r.hidden.passed === r.hidden.total
/** The tests of the project pass, and the code is wrong. */
const falseGreen = (r: Row): boolean => r.green && !solved(r)
const pct = (n: number, of: number): string => (of ? `${Math.round((100 * n) / of)}%` : '-')
const table = (head: string[], body: (string | number)[][]): string =>
  [head, head.map(() => '---'), ...body].map(cells => `| ${cells.join(' | ')} |`).join('\n')

const out: string[] = []
out.push(
  table(
    [
      'task',
      'tool',
      'agent',
      'setup',
      'hidden',
      'npm test',
      'check',
      'review',
      'asserts removed',
      'mutation',
      'false green',
      'turns',
      'cost',
      'time',
    ],
    rows.map(r => [
      r.task,
      r.framework,
      r.agent,
      r.setup,
      `${r.hidden.passed}/${r.hidden.total}`,
      r.green ? 'pass' : 'FAIL',
      r.check === undefined ? '' : r.check ? 'pass' : 'FAIL',
      r.review ?? '',
      r.removed || '',
      `${r.mutation.killed}/${r.mutation.total}`,
      falseGreen(r) ? 'YES' : '',
      r.turns ?? '',
      r.cost === undefined ? '' : `$${r.cost.toFixed(3)}`,
      `${(r.ms / 1000).toFixed(0)} s`,
    ]),
  ),
)
// One line for each test tool, agent, and setup: the numbers to compare.
const groups = new Map<string, Row[]>()
for (const r of rows) {
  const key = [r.framework, r.agent, r.setup].join(' | ')
  groups.set(key, [...(groups.get(key) ?? []), r])
}
out.push(
  '',
  table(
    ['tool', 'agent', 'setup', 'runs', 'solved', 'false green', 'mutation', 'cost'],
    [...groups].map(([key, g]) => {
      const sum = (f: (r: Row) => number): number => g.reduce((n, r) => n + f(r), 0)
      return [
        ...key.split(' | '),
        g.length,
        pct(g.filter(solved).length, g.length),
        g.filter(falseGreen).length,
        pct(
          sum(r => r.mutation.killed),
          sum(r => r.mutation.total),
        ),
        `$${sum(r => r.cost ?? 0).toFixed(3)}`,
      ]
    }),
  ),
)
for (const r of rows) if (r.error) out.push(`error: ${r.task}, ${r.framework}, ${r.agent}, ${r.setup}: ${r.error}`)
const results = join(here, 'results')
mkdirSync(results, { recursive: true })
const file = join(results, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(file, JSON.stringify({ vitest: vitestVersion, node: process.version, rows }, null, 2) + '\n')
out.push(`results: ${file}`)
process.stdout.write(out.join('\n') + '\n')
