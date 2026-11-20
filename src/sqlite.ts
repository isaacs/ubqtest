// `node:sqlite`, with no warning. Some versions of Node 24 print
// "ExperimentalWarning: SQLite is an experimental feature" to stderr
// when a program loads the module. Each `ubq` command would then
// have that text in its output.
// The module loads at the first open of a database: a test process
// of the runner opens none, and the load takes time.
import { createRequire } from 'node:module'

const load = (): typeof import('node:sqlite') => {
  const emitWarning = process.emitWarning
  // ubq: not measured: this Node gives no warning for node:sqlite
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (!/SQLite is an experimental feature/.test(String(warning)))
      (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest)
  }) as typeof process.emitWarning
  try {
    return createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
    // ubq: not measured: each runtime of the tests has node:sqlite
  } catch {
    const bun = process.versions.bun
    throw new Error(
      `ubq needs the module node:sqlite, and ${bun ? `Bun ${bun}` : 'this runtime'} does not have it. ${bun ? 'Use Bun 1.4 or later: the project, its CI, and each machine that runs the tests need that version.' : 'Use Node 22.18 or later, Bun 1.4 or later, or Deno.'}`,
    )
  } finally {
    process.emitWarning = emitWarning
  }
}
let sqlite: typeof import('node:sqlite') | undefined

// A function that `new` calls returns the object of its `return`.
export const DatabaseSync = function (...args: ConstructorParameters<typeof import('node:sqlite').DatabaseSync>) {
  sqlite ??= load()
  return new sqlite.DatabaseSync(...args)
} as unknown as typeof import('node:sqlite').DatabaseSync
export type DatabaseSync = import('node:sqlite').DatabaseSync
