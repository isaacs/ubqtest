// Fixtures: `cleanup`, `env`, `stub`, `testdir`. A fixture sets something
// up, and removes it when its test ends. See docs/05-api.md,
// section 7.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectRoot, rel, stateDir } from './project.ts'
import { current, fileCleanups, groups, hook, type TestState } from './state.ts'
import { notInWorkerd } from './workerd.ts'

/**
 * The function of `cleanup`. `limit` is a time limit in milliseconds, in
 * place of the default one.
 */
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
    // ubq: not measured: no test calls it after the cleanups of its file
    throw new Error(
      `${name}() was called outside a test, after the cleanup functions of the file ran. Call it before the first test() call.`,
    )
  return state
}

const add = (name: string, fn: CleanupFn): void => {
  const state = owner(name)
  // In a beforeAll hook, the fixture lasts until its group ends.
  ;(state ? state.cleanups : (hook.group?.cleanups ?? fileCleanups)).push(fn)
}

/**
 * Runs `fn` when the test ends. Outside a test: when the file ends.
 * In a `beforeAll` hook: when the group of the hook ends.
 * The functions run in reverse order. An error in one fails the test.
 *
 * ```ts
 * const server = listen(0)
 * cleanup(() => server.close())
 * ```
 */
export const cleanup = (fn: CleanupFn): void => {
  if (typeof fn !== 'function') throw new TypeError('cleanup() needs a function')
  add('cleanup', fn)
}

/**
 * Sets environment variables, or deletes them with `undefined`.
 * The old values come back when the test ends.
 *
 * ```ts
 * env({ NODE_ENV: 'production', DEBUG: undefined })
 * ```
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

/**
 * Sets `object[key]` to `value`. The old property comes back when
 * the test ends: its value or its getter, or no property if the
 * object had none of its own. For a function, `spyOn` also records
 * the calls. The value `undefined` fits each key: it is the form
 * for code that tests if a global is there.
 *
 * ```ts
 * stub(globalThis, 'navigator', { userAgent: 'test' })
 * stub(globalThis, 'performance', undefined)
 * ```
 */
export const stub = <T extends object, K extends PropertyKey>(
  object: T,
  key: K,
  value: K extends keyof T ? T[K] | undefined : unknown,
): void => {
  const target = object as Record<PropertyKey, unknown>
  const own = Object.getOwnPropertyDescriptor(object, key)
  add('stub', () => {
    if (own) Object.defineProperty(object, key, own)
    else delete target[key]
  })
  if (own && !own.configurable)
    throw new TypeError(`stub: ${String(key)} cannot be changed: the property of the object is not configurable`)
  Object.defineProperty(object, key, { value, configurable: true, writable: true, enumerable: own?.enumerable ?? true })
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

/** Folders that `testdir` made, by path. For the `-2` of a second call. */
const made = new Map<string, number>()

/**
 * The folder of the first `testdir` call of a test. `file` is the
 * test file, `id` the test ID. With no test: the folder of the file,
 * or of the `describe` group whose function or hook runs now.
 */
export const testdirPath = (file: string, id: string | undefined): string => {
  const names = (hook.group ?? groups.at(-1))?.path ?? []
  return join(
    projectRoot(),
    '.ubq',
    'testdir',
    ...file.split('/').map(safe),
    id !== undefined ? safe(id.slice(file.length + 3)) : names.length ? `_group-${safe(names.join(' > '))}` : '_file',
  )
}

/**
 * Makes a new folder with `files` in it and returns its path. The
 * folder is removed when the test ends. If the test fails, the
 * folder stays, and the failure names it.
 */
export const makeTestdir = (file: string, files: Files = {}): string => {
  notInWorkerd('testdir')
  const state = owner('testdir')
  stateDir()
  const base = testdirPath(file, state?.id)
  const n = (made.get(base) ?? 0) + 1
  made.set(base, n)
  const dir = base + (n > 1 ? `-${n}` : '')
  // A failed run of this test left its folder.
  rmSync(dir, { recursive: true, force: true })
  write(dir, files)
  add('testdir', () => {
    if (state?.failure) state.kept.push(rel(dir))
    else rmSync(dir, { recursive: true, force: true })
  })
  return dir
}
