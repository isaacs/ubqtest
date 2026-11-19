// File functions, for the tests with a folder of files.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The files below `dir`, as paths from `dir`, in the order of the alphabet. */
export const walk = (dir: string, from = ''): string[] =>
  readdirSync(join(dir, from))
    .sort()
    .flatMap(name => {
      const path = from ? `${from}/${name}` : name
      return statSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path]
    })

export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

export const writeText = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

export const totalSize = (dir: string): number => walk(dir).reduce((sum, file) => sum + statSync(join(dir, file)).size, 0)
