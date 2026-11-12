// The git commit of the project, read from the files of git. No
// `git` process: that costs more than the budget of a run allows.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
        statSync(dot).isDirectory() ? dot : resolve(dir, (read(dot) ?? '').replace(/^gitdir: /, ''))
      const head = read(join(gitDir, 'HEAD'))
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
