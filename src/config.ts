// Project configuration: the `ubq` key of the project's
// `package.json`. See docs/08-config.md.
import { readFileSync } from 'node:fs'
import { join, matchesGlob } from 'node:path'
import { projectRoot } from './project.ts'
import { workerd } from './workerd.ts'

export interface Config {
  /** Glob patterns for test files, from the project root. */
  include?: string[]
  /** Glob patterns for files that are not test files. */
  exclude?: string[]
  /** Glob patterns for files that are part of the tests, and are not test files (D51). */
  helpers?: string[]
  /** Glob patterns for build output and build tools, which are not source of the program (D55). */
  build?: string[]
  /** The default time limit of a test, in milliseconds. */
  timeout?: number
  /** False turns off the rerun of a test that timed out (D14). */
  hangRerun?: boolean
  /** True adds inspector coverage on Bun, with places from a guess (D39). */
  bunInspectorCoverage?: boolean
  /** The server of the pages for `ubqtest/browser` (D45). */
  browser?: { url: string; command?: string }
  /** Test files that run in workerd, each group with its wrangler config (D48). */
  workers?: { config: string; include: string[]; vars?: Record<string, unknown> }[]
  /** Global values that the source reads, as the `define` of vite gives them (D83). */
  define?: Record<string, unknown>
  /** The compiler for source that Node cannot run with only its types removed (D111). */
  transform?: 'typescript' | 'swc'
}

/** An error in the command or in the configuration. Exit code 4. */
export class UsageError extends Error {}

const globs = (v: unknown): boolean => Array.isArray(v) && v.length > 0 && v.every(s => typeof s === 'string' && s)

const browser = (v: unknown): boolean => {
  if (typeof v !== 'object' || !v || Array.isArray(v)) return false
  const { url, command, ...more } = v as Record<string, unknown>
  return (
    typeof url === 'string' &&
    URL.canParse(url) &&
    (command === undefined || (typeof command === 'string' && !!command)) &&
    !Object.keys(more).length
  )
}

const workers = (v: unknown): boolean =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every(entry => {
    if (typeof entry !== 'object' || !entry || Array.isArray(entry)) return false
    const { config, include, vars, ...more } = entry as Record<string, unknown>
    const object = vars === undefined || (typeof vars === 'object' && !!vars && !Array.isArray(vars))
    return typeof config === 'string' && !!config && globs(include) && object && !Object.keys(more).length
  })

const define = (v: unknown): boolean =>
  typeof v === 'object' && !!v && !Array.isArray(v) && Object.keys(v).every(name => /^[A-Za-z_$][\w$]*$/.test(name))

const KEYS: Record<keyof Config, [check: (v: unknown) => boolean, form: string]> = {
  include: [globs, 'a list of glob patterns, such as ["test/**/*.test.ts"]'],
  exclude: [globs, 'a list of glob patterns, such as ["test/slow/**"]'],
  helpers: [
    v => Array.isArray(v) && v.every(s => typeof s === 'string' && s),
    'a list of glob patterns, such as ["src/testing/**"]. An empty list means that no file is a test helper',
  ],
  build: [
    v => Array.isArray(v) && v.every(s => typeof s === 'string' && s),
    'a list of glob patterns, such as ["build/**", "tools/**"]. An empty list means that each file is source of the program',
  ],
  timeout: [v => typeof v === 'number' && v > 0, 'a number of milliseconds, such as 5000'],
  hangRerun: [v => typeof v === 'boolean', 'true or false'],
  bunInspectorCoverage: [v => typeof v === 'boolean', 'true or false'],
  browser: [
    browser,
    'an object with "url", and "command" if ubq must start the server, such as { "url": "http://localhost:5173", "command": "npm run dev" }',
  ],
  workers: [
    workers,
    'a list of objects with "config" and "include", and "vars" for test values, such as [{ "config": "wrangler.jsonc", "include": ["test/**/*.test.ts"] }]',
  ],
  define: [
    define,
    'an object of names and JSON values, such as { "__DEBUG_BUILD__": true }. Each name is a global name: a dot is not permitted',
  ],
  transform: [v => v === 'typescript' || v === 'swc', '"typescript" or "swc"'],
}

let cached: Config | undefined

export const config = (): Config => {
  if (cached) return cached
  const host = workerd()
  if (host) return (cached = host.config)
  let pkg: { ubq?: unknown }
  try {
    pkg = JSON.parse(readFileSync(join(projectRoot(), 'package.json'), 'utf8'))
  } catch {
    // No package.json, or one that is not JSON: no configuration.
    return (cached = {})
  }
  const raw = pkg.ubq ?? {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError('"ubq" in package.json must be an object')
  for (const [key, value] of Object.entries(raw)) {
    const known = KEYS[key as keyof Config]
    if (!known)
      throw new UsageError(
        `unknown key "${key}" in "ubq" in package.json. The keys are: ${Object.keys(KEYS).join(', ')}`,
      )
    if (!known[0](value)) throw new UsageError(`"ubq.${key}" in package.json must be ${known[1]}`)
  }
  return (cached = raw as Config)
}

/**
 * Sets each value of the `define` key on `globalThis`. A test
 * process does this before the test file loads, and the library
 * does it again for a test file that runs as a plain program.
 */
export const setDefines = (): void => {
  for (const [name, value] of Object.entries(config().define ?? {}))
    (globalThis as Record<string, unknown>)[name] = value
}

/**
 * With no `helpers` key: a file in a folder with the name `test`,
 * `tests`, or `__tests__`, at each depth. A regular expression does
 * not load the glob code of Node, which costs time at the end of
 * each run.
 */
const HELPERS = /(^|\/)(test|tests|__tests__)\//

/**
 * True for a test helper: a file that is part of the tests and is
 * not a test file, such as a setup module or the scenario of an
 * end-to-end test. A helper is not code of the program, so it is
 * not in the list of code that no test runs. `file` is a path from
 * the project root.
 */
export const isHelper = (file: string): boolean =>
  // ubq: not measured: child-preload.ts loads this module before counters start
  config().helpers?.some(pattern => matchesGlob(file, pattern)) ?? HELPERS.test(file)

/**
 * With no `build` key: the common names for build output and for
 * the scripts of a project, the folders `dist` and `scripts` at the
 * root, and the config file of a tool, such as `vite.config.ts`.
 */
const BUILD = /^(dist|scripts)\/|(^|\/)[^/]+\.config\.[cm]?[jt]s$/

/**
 * True for a file that is not source of the program: the output of
 * a build, or a tool that makes the build. Such a file is not in
 * the list of code that no test runs. If a built file has a source
 * map, its coverage is coverage of the source files.
 */
export const isBuild = (file: string): boolean =>
  // ubq: not measured: child-preload.ts loads this module before counters start
  config().build?.some(pattern => matchesGlob(file, pattern)) ?? BUILD.test(file)
