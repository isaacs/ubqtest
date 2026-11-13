// The git commit of the project, read from the files of git. No
// `git` process: that costs more than the budget of a run allows.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { UsageError } from './config.ts'
import { projectRoot } from './project.ts'

const read = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return undefined
  }
}

/** The hash of the commit that is checked out, or undefined if the project is not in git. */
export const headCommit = (): string | undefined => {
  for (let dir = projectRoot(); ; dir = dirname(dir)) {
    const dot = join(dir, '.git')
    if (existsSync(dot)) {
      // In a worktree, `.git` is a file that names the git folder.
      const gitDir =
        // ubq: not measured: a `.git` file that exists can be read
        statSync(dot).isDirectory() ? dot : resolve(dir, (read(dot) ?? '').replace(/^gitdir: /, ''))
      const head = read(join(gitDir, 'HEAD'))
      // ubq: not measured: git always writes HEAD
      if (!head) return undefined
      if (!head.startsWith('ref: ')) return head
      const ref = head.slice(5)
      // The refs of a worktree are in the main git folder.
      const common = resolve(gitDir, read(join(gitDir, 'commondir')) ?? '.')
      const loose = read(join(gitDir, ref)) ?? read(join(common, ref))
      if (loose) return loose
      const packed = read(join(common, 'packed-refs'))
        ?.split('\n')
        .find(line => line.endsWith(` ${ref}`))
      return packed?.slice(0, packed.indexOf(' '))
    }
    if (dir === dirname(dir)) return undefined
  }
}

/** The first and the last line of a group of lines. Both from 1. */
export type Lines = [first: number, last: number]

/**
 * `--diff` or `--diff=<commit>` in the arguments of a command: the
 * commit, or undefined with no such option. Removes the option.
 */
export const diffOption = (args: string[]): string | undefined => {
  const at = args.findIndex(a => a === '--diff' || a.startsWith('--diff='))
  if (at < 0) return undefined
  return args.splice(at, 1)[0]!.slice('--diff='.length) || 'HEAD'
}

/**
 * The lines of each project file that are not the same as in a
 * commit: lines that changed, new lines, and all lines of a file
 * that git does not have. This starts `git`, so it is not for the
 * start of each run.
 */
export const changedLines = (commit: string): Map<string, Lines[]> => {
  const { spawnSync } = process.getBuiltinModule('node:child_process')
  const git = (...args: string[]): string => {
    const r = spawnSync('git', args, { cwd: projectRoot(), encoding: 'utf8', maxBuffer: 1 << 28 })
    // ubq: not measured: git is on the path in each test
    if (r.error) throw new UsageError(`--diff needs git: ${r.error.message}`)
    if (r.status) throw new UsageError(`--diff: ${r.stderr.trim().split('\n')[0]}`)
    return r.stdout
  }
  const out = new Map<string, Lines[]>()
  let lines: Lines[] | undefined
  for (const line of git('diff', '-U0', '--no-color', '--no-ext-diff', '--relative', commit, '--', '.').split('\n')) {
    if (line.startsWith('+++ ')) {
      // `+++ /dev/null` is a file that went away.
      lines = line.startsWith('+++ b/') ? [] : undefined
      if (lines) out.set(line.slice(6), lines)
    } else if (lines) {
      const m = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line)
      const count = +(m?.[2] ?? 1)
      if (m && count) lines.push([+m[1]!, +m[1]! + count - 1])
    }
  }
  for (const file of git('ls-files', '--others', '--exclude-standard').split('\n'))
    if (file) out.set(file, [[1, Infinity]])
  return out
}

