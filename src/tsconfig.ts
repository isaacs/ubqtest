// The parts of a tsconfig file that ubq reads with no compiler: the
// type check, `ubq doctor`, and the transform of the source.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, matchesGlob, relative, resolve } from 'node:path'

/** `// ...` and `/* ... *\/` comments, and commas before `}` or `]`. */
export const plainJson = (text: string): string =>
  text
    .replace(/("(?:\\.|[^"\\])*")|\/\/.*|\/\*[\s\S]*?\*\//g, (_, string) => string ?? '')
    .replace(/,(\s*[}\]])/g, '$1')

/** The parts of a tsconfig file that say which files it has. */
export interface Tsconfig {
  include?: string[]
  files?: string[]
  exclude?: string[]
  extends?: string | string[]
  references?: { path: string }[]
}

/** True if the lists of the config of `dir` (`files`, `include`, `exclude`) have the file. */
export const listed = (json: Tsconfig, dir: string, file: string): boolean => {
  const path = relative(dir, file).split('\\').join('/')
  // A name with no pattern is a file or a folder.
  const match = (globs: string[]): boolean =>
    globs.some(glob => {
      const name = glob.replace(/^\.\//, '').replace(/\/$/, '')
      return name === '.' || name === '' || matchesGlob(path, name) || matchesGlob(path, `${name}/**`)
    })
  if (json.exclude && match(json.exclude)) return false
  if (json.files?.some(name => name.replace(/^\.\//, '') === path)) return true
  return json.include ? match(json.include) : !json.files
}

/** The config of a folder that ubq reads, if the folder has it, and not `tsconfig.json`. */
export const OWN_CONFIG = 'tsconfig.ubq.json'

/**
 * The compilerOptions of a tsconfig file, with the options of each
 * config that it extends. Throws if a file cannot be read.
 */
export const tsOptions = (file: string): Record<string, unknown> => {
  const json = JSON.parse(plainJson(readFileSync(file, 'utf8')))
  const options: Record<string, unknown> = {}
  for (const base of [json.extends ?? []].flat() as string[])
    Object.assign(options, tsOptions(tsBase(base, dirname(file))))
  return Object.assign(options, json.compilerOptions)
}

/** The file of a base config: a path, or a config in a package. */
const tsBase = (base: string, dir: string): string => {
  if (base.startsWith('.') || isAbsolute(base)) {
    const path = resolve(dir, base)
    return existsSync(path) || path.endsWith('.json') ? path : `${path}.json`
  }
  const require = createRequire(join(dir, 'tsconfig.json'))
  if (base.endsWith('.json')) return require.resolve(base)
  try {
    return require.resolve(`${base}/tsconfig.json`)
  } catch {
    return require.resolve(`${base}.json`)
  }
}
