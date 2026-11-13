// `node:sqlite`, with no warning. Some versions of Node 24 print
// "ExperimentalWarning: SQLite is an experimental feature" to stderr
// when a program loads the module. Each `ubq` command would then
// have that text in its output.
import { createRequire } from 'node:module'

const emitWarning = process.emitWarning
// ubq: not measured: this Node gives no warning for node:sqlite
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  if (!/SQLite is an experimental feature/.test(String(warning)))
    (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest)
}) as typeof process.emitWarning
const sqlite = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
process.emitWarning = emitWarning

export const DatabaseSync = sqlite.DatabaseSync
export type DatabaseSync = import('node:sqlite').DatabaseSync
