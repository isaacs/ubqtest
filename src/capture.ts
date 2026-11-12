// Console capture: text that the code under test writes to stdout
// or stderr becomes `output` events, with the test that wrote it.
import { Console } from 'node:console'
import { emit } from './emit.ts'
import { current } from './state.ts'

/** Replaces the write functions of stdout and stderr. */
export const startCapture = (file: () => string): void => {
  for (const stream of ['stdout', 'stderr'] as const) {
    process[stream].write = ((
      chunk: string | Uint8Array,
      a?: unknown,
      b?: unknown,
    ): boolean => {
      const text =
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
      const id = current.getStore()?.id
      emit({ type: 'output', file: file(), ...(id && { id }), stream, text })
      const done = typeof a === 'function' ? a : b
      if (typeof done === 'function') done()
      return true
    }) as typeof process.stdout.write
  }
  // The console of Deno does not write through `process.stdout`.
  if (process.versions.deno) globalThis.console = new Console(process.stdout, process.stderr)
}
