// `ubq --baseline <git ref>`: runs the tests of a commit in a clean
// checkout, so that the run of the working tree can show which
// failures are new. See docs/04-architecture.md, section 6.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from './sqlite.ts'
import { UsageError } from './config.ts'
import { projectRoot } from './project.ts'
import { stateDir } from './store.ts'

type Status = 'pass' | 'fail' | 'skip'

export interface Baseline {
  ref: string
  /** The short hash of the commit. */
  commit: string
  /** The result of each test that ran in the checkout. */
  tests: Map<string, Status>
  /** Files that had a file error in the checkout. */
  errors: Set<string>
}

const CLI = fileURLToPath(
  new URL(`./cli${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url),
)

const git = (args: string[]): { ok: boolean; out: string; err: string } => {
  const r = spawnSync('git', args, { cwd: projectRoot(), encoding: 'utf8' })
  // ubq: not measured: the output is null only if git does not start
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

/**
 * Runs the tests of commit `ref` in a temporary worktree. `files`
 * are test files of the project, as paths from the project root.
 * Undefined runs all test files that the commit has.
 */
export const runBaseline = async (ref: string, files: string[] | undefined): Promise<Baseline> => {
  const prefix = git(['rev-parse', '--show-prefix'])
  if (!prefix.ok)
    throw new UsageError('--baseline needs a git repository, and this project is not in one')
  const full = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  if (!full.ok)
    throw new UsageError(
      `--baseline needs a git commit, and git does not know: ${ref}. Examples: ubq --baseline HEAD, ubq --baseline main`,
    )
  const commit = full.out.slice(0, 7)
  // The checkout is in the state folder of the project, so that the
  // code in it finds the `node_modules` of the project.
  const tree = join(stateDir(), 'baseline', commit)
  const remove = (): void => {
    git(['worktree', 'remove', '--force', tree])
    rmSync(tree, { recursive: true, force: true })
    git(['worktree', 'prune'])
  }
  // A run that was stopped can leave its checkout.
  remove()
  const added = git(['worktree', 'add', '--detach', tree, full.out])
  // ubq: not measured: git can add a worktree in each test
  if (!added.ok) throw new UsageError(`git cannot make a checkout of ${ref}: ${added.err}`)
  try {
    const root = join(tree, prefix.out)
    const result: Baseline = { ref, commit, tests: new Map(), errors: new Set() }
    const present = files?.filter(f => existsSync(join(root, f)))
    // The commit has none of the selected files: all the tests are new.
    if (!existsSync(join(root, 'package.json')) || present?.length === 0) return result
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('UBQ_')))
    const [code, stderr] = await new Promise<[number | null, string]>(done => {
      const child = spawn(process.execPath, [CLI, ...(present ?? [])], {
        cwd: root,
        env,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let text = ''
      child.stderr.setEncoding('utf8').on('data', (t: string) => (text += t))
      child.on('close', c => done([c, text]))
    })
    // Code 2: the commit has no tests.
    if (code !== 0 && code !== 1 && code !== 2)
      throw new UsageError(
        `the run of the baseline ${ref} did not work (exit code ${code}):\n${stderr.trim().split('\n').slice(-12).join('\n')}`,
      )
    const path = join(root, '.ubq', 'runs.db')
    // ubq: not measured: the run of a baseline always makes a store
    if (!existsSync(path)) return result
    const db = new DatabaseSync(path, { readOnly: true })
    for (const t of db
      .prepare('select id, status from test where run = (select max(id) from run)')
      .all() as { id: string; status: Status }[])
      result.tests.set(t.id, t.status)
    for (const e of db
      .prepare('select file from file_error where run = (select max(id) from run)')
      .all() as { file: string }[])
      result.errors.add(e.file)
    db.close()
    return result
  } finally {
    remove()
  }
}

/**
 * The lines that compare a run with its baseline. `now` has the
 * result of each test of the run, `errors` the files with a file
 * error.
 */
export const compare = (
  base: Baseline,
  now: Map<string, Status>,
  errors: Set<string>,
): string[] => {
  const fresh: string[] = []
  const old: string[] = []
  const fixed: string[] = []
  for (const [id, status] of now) {
    const before = base.tests.get(id)
    if (status === 'fail') (before === 'fail' ? old : fresh).push(id)
    else if (status === 'pass' && before === 'fail') fixed.push(id)
  }
  // ubq: not measured: no baseline test has a new file error
  for (const file of errors) (base.errors.has(file) ? old : fresh).push(`ERROR ${file}`)
  const gone = [...base.tests.keys()].filter(id => !now.has(id)).length
  const parts = [
    `${fresh.length} new failures`,
    `${old.length} failed in the baseline too`,
    `${fixed.length} fixed`,
    ...(gone ? [`${gone} tests of the baseline did not run`] : []),
  ]
  const lines = [`baseline ${base.ref} (${base.commit}): ${parts.join(', ')}`]
  const list = (head: string, ids: string[]): void => {
    if (!ids.length) return
    lines.push(head)
    for (const id of ids.slice(0, 20)) lines.push(`  ${id}`)
    // ubq: not measured: no baseline test has more than 20 changes
    if (ids.length > 20) lines.push(`  and ${ids.length - 20} more`)
  }
  list("failed in the baseline too (not shown above; for one of them: ubq show '<test id>'):", old)
  list('fixed:', fixed)
  return lines
}
