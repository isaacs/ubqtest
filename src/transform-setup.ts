// `ubq convert --transform=<compiler>`: sets the `transform` key of
// the project, and installs the compiler if the project does not
// have it (D111).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { UsageError } from './config.ts'
import { projectRoot } from './project.ts'
import { transformer } from './transform.ts'

/** The lock file of each package manager, and its command that adds a devDependency. */
const MANAGERS: [lock: string, command: string[]][] = [
  ['pnpm-lock.yaml', ['pnpm', 'add', '--save-dev']],
  ['yarn.lock', ['yarn', 'add', '--dev']],
  ['bun.lock', ['bun', 'add', '--dev']],
  ['bun.lockb', ['bun', 'add', '--dev']],
]

/** The command of the package manager of the project that adds a devDependency. */
export const addCommand = (root: string): string[] => {
  for (let dir = root; ; dir = dirname(dir)) {
    const found = MANAGERS.find(([lock]) => existsSync(join(dir, lock)))
    // pnpm does not add a package at the root of a workspace with no `-w`.
    if (found)
      return found[0] === 'pnpm-lock.yaml' && existsSync(join(root, 'pnpm-workspace.yaml'))
        ? [...found[1], '-w']
        : found[1]
    if (dirname(dir) === dir) return ['npm', 'install', '--save-dev']
  }
}

export const setupTransform = (compiler: string, out: (text: string) => void): number => {
  if (compiler !== 'typescript' && compiler !== 'swc')
    throw new UsageError('--transform needs a compiler: --transform=typescript or --transform=swc')
  const root = projectRoot()
  const file = join(root, 'package.json')
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    throw new UsageError('ubq convert --transform needs a package.json: it sets the "transform" key there')
  }
  const has = (): boolean => {
    try {
      createRequire(file).resolve('@swc/core/package.json')
      return true
    } catch {
      return false
    }
  }
  if (compiler === 'swc' && !has()) {
    const command = [...addCommand(root), '@swc/core']
    out(`ubq: ${command.join(' ')}`)
    // On Windows, the command of a package manager is a script.
    const done = spawnSync(command[0]!, command.slice(1), {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    if (done.status !== 0 || !has()) {
      out(
        `ubq: the install of @swc/core failed. Run it yourself, and then run this command again: ${command.join(' ')}`,
      )
      return 1
    }
    text = readFileSync(file, 'utf8')
  }
  try {
    // The project has the package, in a version that can compile one file.
    transformer(root, compiler)
  } catch (error) {
    throw new UsageError((error as Error).message)
  }
  const pkg = JSON.parse(text) as { ubq?: Record<string, unknown> }
  pkg.ubq = { ...pkg.ubq, transform: compiler }
  // The indent and the last line of the file stay as they are.
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? '  '
  writeFileSync(file, JSON.stringify(pkg, null, indent) + (text.endsWith('\n') ? '\n' : ''))
  out(
    `ubq: package.json has "transform": "${compiler}" in "ubq". The ${compiler === 'swc' ? '@swc/core' : 'typescript'} package of the project now makes the JavaScript of each TypeScript file, with the options of the tsconfig.json of its folder. Remove "erasableSyntaxOnly" from each tsconfig.\nnext: ubq`,
  )
  return 0
}
