// The server of the pages for `ubqtest/browser`: the `browser` key
// of the configuration (D45). The runner starts `browser.command`
// if a test file of the run uses the browser and nothing answers at
// `browser.url`.
import { spawn } from 'node:child_process'
import { closeSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config, UsageError } from './config.ts'
import { projectRoot, rel, stateDir } from './project.ts'

const START_MS = 30_000

const answers = async (url: string): Promise<boolean> => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) })
    return true
  } catch {
    return false
  }
}

/**
 * Starts the server, if the run needs it. `files` are the test files
 * of the run. Returns the process ID of the server that it started,
 * which is the leader of a new process group (not on Windows).
 */
export const startBrowserServer = async (files: string[]): Promise<number | undefined> => {
  const { url, command } = config().browser ?? {}
  if (!url || !command) return undefined
  const root = projectRoot()
  if (!files.some(file => readFileSync(join(root, file), 'utf8').includes('ubqtest/browser'))) return undefined
  if (await answers(url)) return undefined
  const log = join(stateDir(), 'browser-server.log')
  const fd = openSync(log, 'w')
  const child = spawn(command, { cwd: root, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', fd, fd] })
  closeSync(fd)
  // The server must not keep the runner open.
  child.unref()
  let exit: number | null | undefined
  // ubq: not measured: the code is null only after a signal
  child.on('exit', code => (exit = code ?? 1))
  const end = Date.now() + START_MS
  while (!(await answers(url))) {
    const why =
      exit !== undefined ? `ended with exit code ${exit}`
      : Date.now() > end ? `did not answer at ${url} in ${START_MS / 1000} seconds`
      : undefined
    if (why) {
      const output = readFileSync(log, 'utf8').trim().split('\n').slice(-5).join('\n  ')
      throw new UsageError(
        `"ubq.browser.command" in package.json (${command}) ${why}. Its output is in ${rel(log)}${output ? `:\n  ${output}` : ''}`,
      )
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return child.pid
}
