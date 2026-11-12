// Fixtures: `cleanup`, `env`, `testdir`. A fixture sets something
// up, and removes it when its test ends. See docs/05-api.md,
// section 7.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectRoot, rel, stateDir } from './project.ts'
import { current, fileCleanups, type TestState } from './state.ts'

/** `limit` is a time limit in milliseconds, in place of the default one. */
export type CleanupFn = (() => void | Promise<void>) & { limit?: number }

export { fileCleanups }
/** `ran` is true after the cleanup functions of the file ran. */
export const fileState = { ran: false }

/** The test that the code runs in, or undefined at the top level of the file. */
const owner = (name: string): TestState | undefined => {
  const state = current.getStore()
  if (state?.ended)
    throw new Error(
      `${name}() was called after its test ended. Call it before the test function returns, or await the code that calls it.`,
    )
  if (!state && fileState.ran)
    throw new Error(
      `${name}() was called outside a test, after the cleanup functions of the file ran. Call it before the first test() call.`,
    )
  return state
}

const add = (name: string, fn: CleanupFn): void => {
  const state = owner(name)
  ;(state ? state.cleanups : fileCleanups).push(fn)
}

/**
 * Runs `fn` when the test ends. Outside a test: when the file ends.
 * The functions run in reverse order. An error in one fails the test.
 */
export const cleanup = (fn: CleanupFn): void => {
  if (typeof fn !== 'function') throw new TypeError('cleanup() needs a function')
  add('cleanup', fn)
}

/**
 * Sets environment variables, or deletes them with `undefined`.
 * The old values come back when the test ends.
 */
export const env = (vars: Record<string, string | undefined>): void => {
  const old = Object.keys(vars).map(name => [name, process.env[name]] as const)
  add('env', () => {
    for (const [name, value] of old)
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
  })
  for (const [name, value] of Object.entries(vars))
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
}

/** File names with their content. A nested object is a folder. */
export interface Files {
  [name: string]: string | Uint8Array | Files
}

const write = (dir: string, files: Files): void => {
  mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name)
    if (typeof content === 'string' || content instanceof Uint8Array) {
      // A name can have folders in it: 'src/a.ts'.
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
    } else write(path, content)
  }
}

const safe = (text: string): string => text.replace(/[^A-Za-z0-9._-]+/g, '-')

/** Folders that `testdir` made, by test ID. For the `-2` of a second call. */
const made = new Map<string, number>()

/** The folder of the first `testdir` call of a test. `file` is the test file, `id` the test ID. */
export const testdirPath = (file: string, id: string | undefined): string =>
  join(
    projectRoot(),
    '.ubq',
    'testdir',
    ...file.split('/').map(safe),
    id === undefined ? '_file' : safe(id.slice(file.length + 3)),
  )

/**
 * Makes a new folder with `files` in it and returns its path. The
 * folder is removed when the test ends. If the test fails, the
 * folder stays, and the failure names it.
 */
export const makeTestdir = (file: string, files: Files = {}): string => {
  const state = owner('testdir')
  stateDir()
  const key = state?.id ?? ''
  const n = (made.get(key) ?? 0) + 1
  made.set(key, n)
  const dir = testdirPath(file, state?.id) + (n > 1 ? `-${n}` : '')
  // A failed run of this test left its folder.
  rmSync(dir, { recursive: true, force: true })
  write(dir, files)
  add('testdir', () => {
    if (state?.failure) state.kept.push(rel(dir))
    else rmSync(dir, { recursive: true, force: true })
  })
  return dir
}
