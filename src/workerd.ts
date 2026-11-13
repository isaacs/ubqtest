// What a test file in the Workers runtime (workerd) gets from the
// process that started it. See docs/02-decisions.md, D48.
import type { Config } from './config.ts'

export interface Workerd {
  /** The project root. workerd has no file system to find it in. */
  root: string
  config: Config
  /** The bindings of the Worker. */
  env: Record<string, unknown>
  /** For each D1 binding: its migrations, each as single statements. */
  migrations: Record<string, { name: string; queries: string[] }[]>
  /** Sends the events that wait to the host process, and waits for its answer. */
  flush(): Promise<void>
  /** Set by the test API: waits for the tests, then ends the file. */
  finish?: () => Promise<void>
}

/** The name of the function that has the code of a test file after its imports. */
export const RUN = '__ubqrun'

export const WORKERD = Symbol.for('ubqtest.workerd')

/** Undefined in a process that is not workerd. */
export const workerd = (): Workerd | undefined => (globalThis as { [WORKERD]?: Workerd })[WORKERD]

/** Throws in workerd, for a function that needs what workerd does not have. */
export const notInWorkerd = (name: string): void => {
  if (workerd()) throw new Error(`${name} does not work in the Workers runtime`)
}
