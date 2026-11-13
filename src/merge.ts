// `ubq merge`: adds the coverage of other stores to the store of
// this project (D54). A run on one runtime and one system cannot
// run each line of a project that has code for more than one. Each
// CI job keeps its store, and one job merges them.
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { UsageError } from './config.ts'
import { DatabaseSync } from './sqlite.ts'
import { ENV, fileHash, openStore } from './store.ts'

/** The store file for an argument: the file itself, a `.ubq` folder, or a project folder. */
const storeFile = (arg: string): string => {
  const path = resolve(arg)
  const found = [path, join(path, 'runs.db'), join(path, '.ubq', 'runs.db')].find(p => existsSync(p) && statSync(p).isFile())
  if (!found) throw new UsageError(`no store at ${arg}. Give a project folder, a .ubq folder, or a runs.db file.`)
  return found
}

interface Row {
  env: string
  tfile: string
  test: string
  file: string
  ranges: string
  hash: string
}

export const mergeCommand = (args: string[], out: (text: string) => void): number => {
  if (!args.length || args.some(arg => arg.startsWith('--')))
    throw new UsageError('ubq merge needs the stores to add: a project folder, a .ubq folder, or a runs.db file')
  const files = args.map(storeFile)
  const store = openStore()
  const version = (db: DatabaseSync): number => (db.prepare('pragma user_version').get() as { user_version: number }).user_version
  const add = store.db.prepare('insert or replace into other_coverage (env, tfile, test, file, ranges, hash) values (?, ?, ?, ?, ?, ?)')
  /** Files whose content is not that of the store that is read. */
  const differ = new Set<string>()
  const hashes = new Map<string, string>()
  try {
    for (const [i, file] of files.entries()) {
      const from = new DatabaseSync(file, { readOnly: true })
      try {
        if (version(from) !== version(store.db))
          throw new UsageError(`${args[i]} is the store of a different version of ubq. Make it with the version of this project.`)
        const rows = from
          .prepare(
            `select ${ENV} as env, c.tfile, c.test, c.file, c.ranges, c.hash from coverage c join run r on r.id = c.run
             union all select env, tfile, test, file, ranges, hash from other_coverage`,
          )
          .all() as unknown as Row[]
        const envs = new Set<string>()
        store.db.exec('begin immediate')
        for (const row of rows) {
          add.run(row.env, row.tfile, row.test, row.file, row.ranges, row.hash)
          envs.add(row.env)
          if (!hashes.has(row.file)) hashes.set(row.file, fileHash(row.file))
          if (hashes.get(row.file) !== row.hash) differ.add(row.file)
        }
        store.db.exec('commit')
        out(`merged ${args[i]}: ${rows.length} coverage rows of ${[...envs].sort().join(', ') || 'no run'}`)
      } finally {
        from.close()
      }
    }
  } finally {
    store.close()
  }
  if (differ.size) {
    const names = [...differ].sort()
    out(
      // ubq: not measured: no test merges more than 5 changed files
      `note: ${names.length} files are not the same here as in a store that was merged: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ', ...' : ''}. Coverage of a file counts only if the file has the same content. Make each store from the same commit.`,
    )
  }
  return 0
}
