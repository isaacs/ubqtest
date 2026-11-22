// Console capture: text that the code under test writes to stdout
// or stderr becomes `output` events, with the test that wrote it.
import { Console } from 'node:console'
import { Writable } from 'node:stream'
import { emit } from './emit.ts'
import { current } from './state.ts'

/** The key of the `console` of test files, on `globalThis`. */
export const TEST_CONSOLE = Symbol.for('ubqtest.console')

/** A write function that sends the text as `output` events. */
const writer =
  (file: () => string, stream: 'stdout' | 'stderr', print?: true) =>
  (chunk: string | Uint8Array, a?: unknown, b?: unknown): boolean => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
    const id = current.getStore()?.id
    emit({ type: 'output', file: file(), ...(id && { id }), stream, text, ...(print && { print }) })
    const done = typeof a === 'function' ? a : b
    if (typeof done === 'function') done()
    return true
  }

/**
 * Replaces the write functions of stdout and stderr, and makes the
 * `console` of test files.
 */
export const startCapture = (file: () => string): void => {
  for (const stream of ['stdout', 'stderr'] as const)
    process[stream].write = writer(file, stream) as typeof process.stdout.write
  // The console of Deno and of Bun does not write through
  // `process.stdout`.
  if (process.versions.deno || process.versions.bun) globalThis.console = new Console(process.stdout, process.stderr)
  const stream = (name: 'stdout' | 'stderr'): Writable => new Writable({ write: writer(file, name, true) })
  const printing = new Console(stream('stdout'), stream('stderr')) as unknown as Record<PropertyKey, unknown>
  const real = globalThis.console as unknown as Record<PropertyKey, unknown>
  const first = new Map(Object.entries(real))
  // A method of the test file's console prints also when the test
  // passes. A method that a test replaced (spyOn, `console.log =
  // fn`) is the one of the global console: the test sees the calls
  // of the code under test. The proxy gives each other operation to
  // the global console.
  ;(globalThis as Record<symbol, unknown>)[TEST_CONSOLE] = new Proxy(real, {
    get: (target, key) => {
      const value = Reflect.get(target, key)
      return typeof value === 'function' && first.get(key as string) === value && typeof printing[key] === 'function'
        ? printing[key]
        : value
    },
  })
}
