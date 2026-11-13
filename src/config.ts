// Project configuration: the `ubq` key of the project's
// `package.json`. See docs/08-config.md.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from './project.ts'
import { workerd } from './workerd.ts'

export interface Config {
  /** Glob patterns for test files, from the project root. */
  include?: string[]
  /** Glob patterns for files that are not test files. */
  exclude?: string[]
  /** The default time limit of a test, in milliseconds. */
  timeout?: number
  /** False turns off the rerun of a test that timed out (D14). */
  hangRerun?: boolean
  /** True adds inspector coverage on Bun, with places from a guess (D39). */
  bunInspectorCoverage?: boolean
  /** The server of the pages for `ubqtest/browser` (D45). */
  browser?: { url: string; command?: string }
  /** Test files that run in workerd, each group with its wrangler config (D48). */
  workers?: { config: string; include: string[] }[]
}

/** An error in the command or in the configuration. Exit code 4. */
export class UsageError extends Error {}

const globs = (v: unknown): boolean =>
  Array.isArray(v) && v.length > 0 && v.every(s => typeof s === 'string' && s)

const browser = (v: unknown): boolean => {
  if (typeof v !== 'object' || !v || Array.isArray(v)) return false
  const { url, command, ...more } = v as Record<string, unknown>
  return (
    typeof url === 'string' && URL.canParse(url) && (command === undefined || (typeof command === 'string' && !!command)) && !Object.keys(more).length
  )
}

const workers = (v: unknown): boolean =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every(entry => {
    if (typeof entry !== 'object' || !entry || Array.isArray(entry)) return false
    const { config, include, ...more } = entry as Record<string, unknown>
    return typeof config === 'string' && !!config && globs(include) && !Object.keys(more).length
  })

const KEYS: Record<keyof Config, [check: (v: unknown) => boolean, form: string]> = {
  include: [globs, 'a list of glob patterns, such as ["test/**/*.test.ts"]'],
  exclude: [globs, 'a list of glob patterns, such as ["test/slow/**"]'],
  timeout: [v => typeof v === 'number' && v > 0, 'a number of milliseconds, such as 5000'],
  hangRerun: [v => typeof v === 'boolean', 'true or false'],
  bunInspectorCoverage: [v => typeof v === 'boolean', 'true or false'],
  browser: [browser, 'an object with "url", and "command" if ubq must start the server, such as { "url": "http://localhost:5173", "command": "npm run dev" }'],
  workers: [workers, 'a list of objects with "config" and "include", such as [{ "config": "wrangler.jsonc", "include": ["test/**/*.test.ts"] }]'],
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
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw new UsageError('"ubq" in package.json must be an object')
  for (const [key, value] of Object.entries(raw)) {
    const known = KEYS[key as keyof Config]
    if (!known)
      throw new UsageError(
        `unknown key "${key}" in "ubq" in package.json. The keys are: ${Object.keys(KEYS).join(', ')}`,
      )
    if (!known[0](value))
      throw new UsageError(`"ubq.${key}" in package.json must be ${known[1]}`)
  }
  return (cached = raw as Config)
}
