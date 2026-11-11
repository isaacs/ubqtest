// The project root, and paths relative to it.
import { existsSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

let root: string | undefined

/** The folder of the nearest `package.json` at or above the working directory. */
export const projectRoot = (): string => {
  if (root) return root
  const cwd = process.cwd()
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return (root = dir)
    if (dir === dirname(dir)) return (root = cwd)
  }
}

/** An absolute path as a path from the project root, with `/` separators. */
export const rel = (path: string): string =>
  relative(projectRoot(), path).split(sep).join('/')
