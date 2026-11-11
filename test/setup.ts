// Fixture projects import `ubqtest` as a real project does: through
// `node_modules`. This makes the link to the repository root.
import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))

mkdirSync(`${fixtures}node_modules`, { recursive: true })
try {
  symlinkSync(fileURLToPath(new URL('..', import.meta.url)), `${fixtures}node_modules/ubqtest`)
} catch (error) {
  // Test files run in parallel, and each one loads this module.
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
}

/** Removes the run store of a fixture project. */
export const resetStore = (project: string): void =>
  rmSync(`${project}.ubq`, { recursive: true, force: true })
