// Fixture projects import `ubqtest` as a real project does: through
// `node_modules`. This makes the link to the repository root.
import { mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))

// A relative link, so that it stays correct if the repository moves.
const link = `${fixtures}node_modules/ubqtest`
const target = '../../..'
const current = (): string | undefined => {
  try {
    return readlinkSync(link)
  } catch {
    return undefined
  }
}
mkdirSync(`${fixtures}node_modules`, { recursive: true })
if (current() !== target) {
  try {
    rmSync(link, { force: true })
    symlinkSync(target, link)
  } catch (error) {
    // Test files run in parallel, and each one loads this module.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/** Removes the run store of a fixture project. */
export const resetStore = (project: string): void =>
  rmSync(`${project}.ubq`, { recursive: true, force: true })
