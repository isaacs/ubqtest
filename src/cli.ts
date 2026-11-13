#!/usr/bin/env node
// The `ubq` command: runs tests, and answers questions about stored
// runs. See docs/04-architecture.md, section 5.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { doctor } from './doctor.ts'
import { mutate } from './mutate.ts'
import { testdirPath } from './fixtures.ts'
import { changedLines, diffOption } from './git.ts'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { projectRoot, rel } from './project.ts'
import {
  coveredFiles,
  covers,
  diffRuns,
  environments,
  failures,
  fileErrors,
  filesOf,
  flake,
  hasCoverage,
  history,
  incomplete,
  lastResult,
  lastRun,
  outputOf,
  runRow,
  slowest,
  stale,
  testFiles,
  testsUnder,
  typeErrors,
  uncovered,
} from './query.ts'
import { textSink } from './sink-text.ts'
import { isBuild, isHelper } from './config.ts'
import { run, UsageError } from './runner.ts'
import { fileHash, openStore } from './store.ts'

/**
 * For each coding agent: its names for `ubq skill <agent>`, the
 * variables that it sets for the commands that it runs, and its
 * skill folder. The variables are the same list as pnpm.
 */
const SKILL_DIRS: [names: string[], variables: string[], dir: string][] = [
  [['claude'], ['CLAUDECODE', 'CLAUDE_CODE'], '.claude/skills'],
  [['cursor'], ['CURSOR_AGENT'], '.cursor/skills'],
  [['gemini'], ['GEMINI_CLI'], '.gemini/skills'],
  [['copilot'], ['COPILOT_AGENT', 'COPILOT_CLI'], '.github/skills'],
  [['codex', 'antigravity', 'agents'], ['ANTIGRAVITY_AGENT', 'CODEX_THREAD_ID', 'CODEX_SANDBOX', 'AI_AGENT'], '.agents/skills'],
]

/** A line of code for one runtime or one system. */
const ELSEWHERE = /process\.platform|process\.versions\.(bun|deno)|typeof (Bun|Deno)\b|\bDeno\.|\bBun\.|['"](win32|darwin|linux)['"]/

/** A file that can have code. */
const CODE = /\.([cm]?[jt]s|[jt]sx)$/

const USAGE = `usage:
  ubq                        run all test files (names that end in .test.ts, .test.js, ...)
  ubq <file or folder>...    run these test files, and the test files in these folders
  ubq <file>:<line>          run the test at that line
  ubq '<test id>'            run one test, or all tests of a group
  ubq --failed               run the tests that failed in their last run
  ubq --changed              run the tests that ran code that has changed, and new test files
  ubq --update <file or test id>...  run these tests and write their snapshots (assert.snapshot)
  ubq --seed <n> ...         run the test files in the order of an older run (the files run in a random order)
  ubq --repeat <n> ...       run the selected tests n times, and count the failures of each test
  ubq --baseline <commit> ...  run the selected tests, and show only the failures that a clean checkout of the git commit does not have
  ubq failures [run]         the failures of a run (default: the last run)
  ubq show <test id>         the last result of one test
  ubq history <test id>      the result of one test in each stored run
  ubq diff [run] [run]       the tests with a different status in two runs (default: the last run and the run before it)
  ubq slow [run]             the slowest tests of a run (default: the last run)
  ubq uncovered [file]       code that no test ran
  ubq merge <store>...       adds the coverage of other stores (a project folder, a .ubq folder, or a runs.db file), such as the stores of CI jobs on other systems
  ubq uncovered --diff       code that no test ran, in the lines that differ from the last git commit (--diff=<commit>: from that commit)
  ubq covers <file>:<line>   the tests that ran a line
  ubq mutate <file>[:<line>] a mutation check: makes small changes to the file, one at a time, and lists each change that no test fails for
  ubq mutate --diff          a mutation check of the lines that differ from the last git commit (--diff=<commit>: from that commit)
  ubq sql <query>            a read-only SQL query on .ubq/runs.db, as JSON lines
  ubq server                 starts a background server that makes runs faster: it keeps test processes ready. ubq server stop stops it
  ubq guide                  how to write and run tests, for the installed version
  ubq guide convert          how to move a project from a different test tool to ubq
  ubq convert <files or folders>  changes the test files of tap, node:test, vitest, jest, or mocha to ubq, and writes a TODO(ubq) comment for each change that it cannot make
  ubq browser install        downloads the browser for tests that use 'ubqtest/browser', if it is not there. Needs the playwright-core package
  ubq doctor                 checks the setup of the project, and states the fix for each problem
  ubq skill [agent|folder]   writes the use-ubq skill to the skill folders of the project and of the agent that runs the command, or to the folder of the named agent (claude, cursor, gemini, copilot, codex)
`

const out = (text: string): void => void process.stdout.write(text + '\n')

const QUERIES = ['failures', 'show', 'history', 'diff', 'slow', 'uncovered', 'covers', 'sql', 'mutate']

const main = async (args: string[]): Promise<number> => {
  const [command, ...rest] = args
  if (command === 'help' || command === '--help' || command === '-h') {
    out(USAGE.trimEnd())
    return 0
  }
  if (command === 'guide') {
    // The guides are at the package root. The bundle is there too.
    if (rest[0] && rest[0] !== 'convert') throw new UsageError('the guides are: ubq guide, ubq guide convert')
    const name = rest[0] ? 'CONVERT.md' : 'GUIDE.md'
    const path = import.meta.url.endsWith('.ts') ? `../${name}` : `./${name}`
    out(readFileSync(new URL(path, import.meta.url), 'utf8').trimEnd())
    return 0
  }
  if (command === 'doctor') return doctor(out) ? 1 : 0
  if (command === 'convert') return (await import('./convert.ts')).convertCommand(rest, out)
  if (command === 'skill') {
    // The skill is at the package root. The bundle is there too.
    const from = new URL(import.meta.url.endsWith('.ts') ? '../skills/use-ubq/SKILL.md' : './skills/use-ubq/SKILL.md', import.meta.url)
    const root = projectRoot()
    const dirs = new Set<string>()
    // `ubq skill cursor`, `ubq skill .myagent/skills`
    for (const arg of rest) {
      const known = SKILL_DIRS.find(([names]) => names.includes(arg))
      if (!known && !/[\\/]/.test(arg))
        throw new UsageError(
          `unknown agent "${arg}". The agents are: ${SKILL_DIRS.flatMap(([names]) => names).join(', ')}. A folder also works: ubq skill .myagent/skills`,
        )
      dirs.add(known?.[2] ?? rel(resolve(arg)))
    }
    if (!rest.length) {
      // The skill folders that the project has: `.claude/skills`,
      // `.cursor/skills`, `.agents/skills`.
      for (const name of readdirSync(root))
        if (name.startsWith('.') && existsSync(join(root, name, 'skills'))) dirs.add(`${name}/skills`)
      // The folder of the agent that runs this command.
      for (const [, variables, dir] of SKILL_DIRS) if (variables.some(name => process.env[name])) dirs.add(dir)
      if (!dirs.size) dirs.add('.claude/skills')
    }
    for (const dir of [...dirs].sort()) {
      const to = join(root, dir, 'use-ubq')
      mkdirSync(to, { recursive: true })
      writeFileSync(join(to, 'SKILL.md'), readFileSync(from))
      out(`wrote ${rel(join(to, 'SKILL.md'))}`)
    }
    return 0
  }
  if (command === 'browser') {
    if (rest.length !== 1 || rest[0] !== 'install') throw new UsageError('the command is: ubq browser install')
    // The package of the project, so that the browser has the
    // version that the package needs.
    let cli: string
    try {
      cli = join(dirname(createRequire(join(projectRoot(), 'package.json')).resolve('playwright-core/package.json')), 'cli.js')
    } catch {
      throw new UsageError('the project does not have the playwright-core package. Run: npm install --save-dev playwright-core')
    }
    const install = [cli, 'install', 'chromium', '--only-shell']
    return spawnSync(process.execPath, process.versions.deno ? ['run', '-A', ...install] : install, { stdio: 'inherit' }).status ?? 1
  }
  if (command === 'server') return (await import('./server.ts')).serverCommand(rest, out)
  if (command === 'merge') return (await import('./merge.ts')).mergeCommand(rest, out)
  if (!command || !QUERIES.includes(command)) return run(args)
  if (!existsSync(join(projectRoot(), '.ubq', 'runs.db')))
    throw new UsageError('no runs are stored. Run a test file first: node <test file>')
  const { db } = openStore()
  const arg = (name: string): string => {
    if (!rest[0]) throw new UsageError(`ubq ${command} needs ${name}`)
    return rest[0]
  }
  const file = (path: string): string => rel(resolve(path))
  /** The \`testdir\` folder that a failed test left. */
  const kept = (t: { file: string; id: string }): string[] => {
    const dir = testdirPath(t.file, t.id)
    return existsSync(dir) ? [rel(dir)] : []
  }

  switch (command) {
    case 'failures': {
      const run = rest[0] ? +rest[0] : lastRun(db)
      const row = run === undefined ? undefined : runRow(db, run)
      if (!row) throw new UsageError(`run ${rest[0] ?? '(last)'} is not in the store`)
      const sink = textSink(text => void process.stdout.write(text))
      for (const e of fileErrors(db, row.id)) sink({ type: 'file-error', ...e })
      for (const t of failures(db, row.id)) {
        sink({
          type: 'test-start',
          id: t.id,
          timeout: 0,
          ...(t.line !== null && { at: { file: t.file, line: t.line, column: 1 } }),
        })
        sink({
          type: 'test-end',
          id: t.id,
          status: 'fail',
          ms: t.ms,
          asserts: t.asserts,
          failure: t.failure!,
          ...(kept(t).length && { kept: kept(t) }),
        })
      }
      const types = typeErrors(db, row.id)
      for (const e of types) sink(e)
      if (row.code === null) out(`run ${row.id} did not end`)
      else {
        // The same parts as the last line of the run.
        const parts = [`${row.fail} failed`, `${row.pass} passed`]
        if (row.errors) parts.unshift(`${row.errors} errors`)
        if (row.skip) parts.push(`${row.skip} skipped`)
        if (row.unselected) parts.push(`${row.unselected} not selected`)
        if (types.length) parts.push(`${types.length} type errors`)
        out(`${row.code ? 'fail' : 'pass'}: ${parts.join(', ')} (run ${row.id})`)
      }
      return row.code ?? 1
    }

    case 'show': {
      const id = rest.join(' ')
      if (!id) throw new UsageError('ubq show needs a test id')
      const t = lastResult(db, id)
      if (!t) throw new UsageError(`no stored result for test: ${id}`)
      out(`${t.status} ${t.id}`)
      out(`  run ${t.run}, ${t.asserts} assertions, ${t.ms.toFixed(1)} ms`)
      if (t.repeats) out(`  failed ${t.fails} of ${t.repeats} times`)
      if (t.line !== null) out(`  at ${t.file}:${t.line}`)
      if (t.reason) out(`  skip reason: ${t.reason}`)
      if (t.failure) {
        out(`  ${t.failure.message}`)
        if (t.failure.at)
          out(`  at ${t.failure.at.file}:${t.failure.at.line}:${t.failure.at.column}`)
        if (t.failure.diff) out('  ' + t.failure.diff.replaceAll('\n', '\n  '))
        if (t.failure.pending) out(`  still open: ${t.failure.pending.join(', ')}`)
        for (const o of t.failure.opened ?? [])
          out(`  ${o.type} opened at ${o.at.file}:${o.at.line}:${o.at.column}`)
      }
      for (const dir of kept(t)) out(`  testdir: ${dir}`)
      const text = outputOf(db, t.run, id).trimEnd()
      if (text) out('  output:\n  | ' + text.replaceAll('\n', '\n  | '))
      const files = filesOf(db, id)
      if (files.length) out(`  ran code in: ${files.join(', ')}`)
      return 0
    }

    case 'history': {
      const id = rest.join(' ')
      if (!id) throw new UsageError('ubq history needs a test id')
      const rows = history(db, id)
      if (!rows.length) {
        const tests = testsUnder(db, id)
        if (!tests.length) throw new UsageError(`no stored result for test: ${id}`)
        const more = tests.length > 10 ? `\n  and ${tests.length - 10} more` : ''
        throw new UsageError(
          `${id} is not a test. It contains these tests:\n  ${tests.slice(0, 10).join('\n  ')}${more}`,
        )
      }
      const width = String(rows.at(-1)!.run).length
      for (const r of rows) {
        const time = new Date(r.time).toISOString().slice(0, 19).replace('T', ' ')
        const rate = r.repeats ? `failed ${r.fails} of ${r.repeats} times` : ''
        const first = r.failure?.message.split('\n')[0]
        const message = rate || first ? `  ${[rate, first].filter(Boolean).join(': ')}` : ''
        out(
          `run ${String(r.run).padStart(width)}  ${time}  ${r.commit ? r.commit.slice(0, 7) + '  ' : ''}${r.status}  ${r.ms.toFixed(1).padStart(7)} ms${message}`,
        )
      }
      const count = (status: string): number => rows.filter(r => r.status === status).length
      const skipped = count('skip') ? `, ${count('skip')} skipped` : ''
      out(`${count('fail')} failed, ${count('pass')} passed${skipped} in ${rows.length} runs (times are UTC)`)
      const f = flake(rows)
      if (f)
        out(
          'run' in f ?
            `flaky: the test failed ${f.fails} of ${f.repeats} times in run ${f.run}`
          : `flaky: the test passed in run ${f.pass} and failed in run ${f.fail}, and the code that it loaded was the same in the two runs`,
        )
      return 0
    }

    case 'diff': {
      if (rest.length > 2) throw new UsageError('ubq diff takes two run numbers at most')
      const last = lastRun(db)
      const given = rest.map(text => {
        if (!/^\d+$/.test(text)) throw new UsageError(`ubq diff needs run numbers, not: ${text}`)
        return +text
      })
      const b = given[1] ?? last
      // The run before \`b\`, if the command does not name a run.
      const a =
        given[0] ??
        (db.prepare('select max(id) id from run where id < ?').get(b ?? 0) as { id: number | null }).id
      for (const run of [a, b])
        if (run == null || !runRow(db, run)) {
          const first = (db.prepare('select min(id) id from run').get() as { id: number | null }).id
          const have = first == null ? 'the store has no runs' : `the store has runs ${first} to ${last}`
          throw new UsageError(
            run == null ? `ubq diff needs two runs, and ${have}` : `run ${run} is not in the store: ${have}`,
          )
        }
      if (a === b) throw new UsageError(`ubq diff needs two different runs, not run ${a} two times`)
      const d = diffRuns(db, a!, b!)
      for (const file of d.newErrors) out(`ERROR ${file} (no error in run ${a})`)
      for (const c of d.changes) {
        out(`${c.to} ${c.id} (${c.from ? `was ${c.from}` : 'did not run'} in run ${a})`)
        if (c.failure) out(`  ${c.failure.message.split('\n')[0]}`)
      }
      for (const file of d.goneErrors) out(`no error ${file} (was ERROR in run ${a})`)
      const failed = d.changes.filter(c => c.to === 'fail').length
      const fixed = d.changes.filter(c => c.from === 'fail' && c.to === 'pass').length
      const other = d.changes.length - failed - fixed
      const parts = [
        `${failed} new failures`,
        `${fixed} fixed`,
        ...(other ? [`${other} other changes`] : []),
        ...(d.newErrors.length ? [`${d.newErrors.length} new file errors`] : []),
        `${d.same} the same`,
        ...(d.onlyA ? [`${d.onlyA} only in run ${a}`] : []),
        ...(d.onlyB ? [`${d.onlyB} only in run ${b}`] : []),
      ]
      out(`run ${a} to run ${b}: ${parts.join(', ')}`)
      for (const run of [a!, b!])
        if (runRow(db, run)!.code === null) out(`note: run ${run} did not end`)
      const bad = failed + d.newErrors.length
      if (bad) out(`details: ubq failures ${b}`)
      return bad ? 1 : 0
    }

    case 'slow': {
      const SHOWN = 10
      const run = rest[0] ? +rest[0] : lastRun(db)
      if (run === undefined || !runRow(db, run))
        throw new UsageError(`run ${rest[0] ?? '(last)'} is not in the store`)
      const tests = slowest(db, run)
      for (const t of tests.slice(0, SHOWN)) out(`${t.ms.toFixed(1).padStart(8)} ms  ${t.id}`)
      const sum = (rows: { ms: number }[]): string => rows.reduce((n, t) => n + t.ms, 0).toFixed(1)
      out(
        `the ${Math.min(SHOWN, tests.length)} slowest of ${tests.length} tests took ${sum(tests.slice(0, SHOWN))} ms of ${sum(tests)} ms (run ${run})`,
      )
      return 0
    }

    case 'uncovered': {
      const commit = diffOption(rest)
      const diff = commit === undefined ? undefined : changedLines(commit)
      const covered = coveredFiles(db)
      // A test helper is not code of the program (D51). A file that
      // the command names is in the list in each case.
      // The same is true for build output and build tools (D55).
      let files = rest[0] ? [file(rest[0])] : covered.filter(f => !isHelper(f) && !isBuild(f))
      const helpers = rest[0] ? 0 : covered.filter(isHelper).length
      const built = rest[0] ? 0 : covered.filter(f => !isHelper(f) && isBuild(f)).length
      /** Ranges in code for one runtime or one system. */
      let elsewhere = 0
      if (rest[0] && !covered.includes(files[0]!))
        throw new UsageError(`no test loaded ${files[0]}`)
      /** Changed files with code that no test loads. */
      const unloaded: string[] = []
      if (diff) {
        files = files.filter(f => diff.has(f))
        const tests = new Set(testFiles(db))
        if (!rest[0])
          for (const f of diff.keys())
            if (CODE.test(f) && !covered.includes(f) && !tests.has(f) && !isHelper(f) && !isBuild(f) && fileHash(f)) unloaded.push(f)
        // The places of the stored coverage must be the places of the file.
        for (const f of files)
          if (stale(db, f))
            throw new UsageError(`${f} changed after the last run of its tests. Run them first: ubq --changed`)
      }
      let total = 0
      /** Ranges with a `ubq: not measured:` comment (D56). */
      let notMeasured = 0
      /** Files with a range in the list. */
      const listed = new Set<string>()
      /** Files whose stored coverage is all of a different content, from a different environment. */
      const old: string[] = []
      /** Files that changed after the last run of their tests: the stored places are not their places. */
      const changed: string[] = []
      for (const f of files) {
        if (!hasCoverage(db, f)) {
          old.push(f)
          continue
        }
        if (stale(db, f)) {
          changed.push(f)
          continue
        }
        for (const u of uncovered(db, f)) {
          if (diff && !diff.get(f)!.some(([first, last]) => first <= u.line + u.moreLines && last >= u.line))
            continue
          if (u.notMeasured) {
            notMeasured++
            continue
          }
          total++
          listed.add(f)
          if (ELSEWHERE.test(u.sourceLine)) elsewhere++
          const more = u.moreLines ? ` (+${u.moreLines} lines)` : ''
          out(`${u.file}:${u.line}:${u.column}  ${u.text}${more}`)
        }
      }
      for (const f of unloaded) out(`${f}  no test loads this file`)
      for (const f of old) out(`${f}  the stored coverage is of a different content of this file. Run the tests again.`)
      for (const f of changed) out(`${f}  changed after the last run of its tests. Run them first: ubq --changed`)
      if (diff) {
        const none = unloaded.length ? `, ${unloaded.length} changed files that no test loads` : ''
        out(`${total} uncovered ranges in the changed lines of ${files.length} files${none}`)
      } else if (rest[0]) out(`${total} uncovered ranges in ${files[0]}`)
      // A file with no uncovered range is not in the list.
      else
        out(
          `${total} uncovered ranges in ${listed.size} of the ${files.length} files that tests ran` +
            (helpers || built ?
              ` (${[helpers && `${helpers} test helpers`, built && `${built} build files`].filter(Boolean).join(' and ')} are not in this list)`
            : ''),
        )
      if (notMeasured)
        out(`${notMeasured} ranges with a "ubq: not measured:" comment are not in this list`)
      // The list is for the runs of more than one environment.
      const envs = environments(db)
      if (envs.length > 1) out(`coverage of: ${envs.join(', ')}`)
      // One run cannot run such code. The reader must know the way.
      if (elsewhere)
        out(
          `note: ${elsewhere} of these ranges are on a line that names a runtime or a system (process.platform, Bun, Deno). A run on one runtime and one system cannot run each of them. Run the tests in each environment, and merge the stores: see "Code for more than one runtime or system" in: ubq guide`,
        )
      const weak = incomplete(db)
      if (weak.length) {
        const names = weak.map(w => `${w.tfile} (${w.coverage})`).join(', ')
        out(
          `note: coverage is not complete for ${weak.length} test files: ${names}. Code can be missing from this list. For full coverage, run the file with ubq: ubq <test file>`,
        )
      }
      // For a check in CI: code of the program that no test runs.
      return total || unloaded.length || old.length || changed.length ? 1 : 0
    }

    case 'covers': {
      const m = /^(.*):(\d+)$/.exec(arg('<file>:<line>'))
      if (!m) throw new UsageError('ubq covers needs <file>:<line>')
      const f = file(m[1]!)
      const c = covers(db, f, +m[2]!)
      for (const t of c.tests) out(t)
      for (const t of c.loads) out(`${t} (while the file loads)`)
      out(`${c.tests.length} tests run ${f}:${m[2]}`)
      return 0
    }

    case 'mutate':
      return mutate(db, rest, out)

    case 'sql': {
      db.exec('pragma query_only = on')
      for (const row of db.prepare(arg('a query')).all()) out(JSON.stringify(row))
      return 0
    }
  }
  throw new UsageError(`unknown command: ${command}`)
}

try {
  // A run of one file in this process sets its own exit code.
  process.exitCode ||= await main(process.argv.slice(2))
} catch (error) {
  const usage = error instanceof UsageError
  // ubq: not measured: only a defect in ubq gives a different error
  process.stderr.write(`ubq: ${usage ? error.message : (error as Error).stack}\n`)
  process.exitCode = 4
}
