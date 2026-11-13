// `ubqtest/browser`: a page of a real browser for a test (D45). The
// driver is Playwright, with Chromium. The project installs the
// `playwright-core` package, and `ubq browser install` downloads
// the browser.
import { existsSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import type { Browser, BrowserContextOptions, BrowserServer, Page } from 'playwright-core'
import { pageCoverage } from './browser-coverage.ts'
import { config } from './config.ts'
import { COUNTER_NAME } from './counters.ts'
import { fileCleanups } from './fixtures.ts'
import { projectRoot } from './project.ts'
import { current, moreCoverage } from './state.ts'

/**
 * The address of the files of the project, if the configuration has
 * no `browser.url`. No server is at this address: the files come
 * from the disk. A page from a `file:` address cannot load a module
 * script, and a page from this address can.
 */
const STATIC = 'http://project.localhost/'

/** The time limit of an action on a page. `assert.eventually` has the same limit. */
const ACTION_MS = 2000

let started: Promise<Browser> | undefined

const start = async (): Promise<Browser> => {
  let playwright: typeof import('playwright-core')
  try {
    playwright = await import('playwright-core')
    // ubq: not measured: ubq's own playwright-core loads in each test
  } catch (error) {
    if (!/playwright-core/.test(String(error)) || !/not found|cannot find|cannot resolve/i.test(String(error))) throw error
    throw new Error(
      "'ubqtest/browser' needs the playwright-core package. Run: npm install --save-dev playwright-core, then: npx ubq browser install",
    )
  }
  const executablePath = process.env.UBQ_BROWSER
  // A separate server process for the browser, so that the end of the
  // file can stop it at once. To close a browser in the normal way
  // can take seconds on Windows, and the test process must not wait.
  let server: BrowserServer
  try {
    server = await playwright.chromium.launchServer(executablePath ? { executablePath } : {})
  } catch (error) {
    if (!executablePath && /Executable doesn't exist/.test(String(error)))
      throw new Error('the browser is not installed. Run: npx ubq browser install')
    throw error
  }
  // The process ends at once. Playwright then removes the folder of
  // the browser, and that can take seconds on Windows on a machine
  // with much work, so this cleanup has a long limit.
  fileCleanups.push(
    Object.assign(
      async () => {
        server.process().kill()
        await server.kill()
      },
      { limit: 60_000 },
    ),
  )
  const browser = await playwright.chromium.connect(server.wsEndpoint())
  return browser
}

/**
 * Import from `'ubqtest/browser'`. The project needs the
 * `playwright-core` package, and `ubq browser install`.
 *
 * A new page of a browser (Chromium), as a `Page` of Playwright. Use
 * the API of Playwright for all work with the page. The page closes
 * when the test ends. An error that the page does not catch fails
 * the test.
 *
 * `page.goto('/a/page.html')` loads a file of the project, from the
 * project root. If the configuration has `browser.url`, the path is
 * from that URL.
 *
 * `options` are the options of `browser.newContext` of Playwright,
 * such as `viewport` or `locale`.
 */
export const browser = async (options: BrowserContextOptions = {}): Promise<Page> => {
  const state = current.getStore()
  if (!state || state.ended)
    throw new Error('browser() must run in a test, before the test ends. Await the call.')
  // The cleanup functions of the file close the browser. A test that
  // starts after that gets a new one.
  if (!started || !(await started).isConnected()) started = start()
  const url = config().browser?.url
  const context = await (await started).newContext({ baseURL: url ?? STATIC, ...options })
  state.cleanups.push(() => context.close())
  // A wait for an element that never comes ends before the test does,
  // with a message that names the element.
  context.setDefaultTimeout(ACTION_MS)
  context.setDefaultNavigationTimeout(30_000)
  if (!url) {
    const root = projectRoot()
    await context.route(STATIC + '**', route => {
      const path = join(root, decodeURIComponent(new URL(route.request().url()).pathname))
      return path.startsWith(root + sep) && existsSync(path) && statSync(path).isFile() ?
          route.fulfill({ path })
        : route.fulfill({ status: 404, body: 'no such file in the project' })
    })
  }
  // A function that the test gives to `page.evaluate` can have
  // counters of the test file in its text. In the page, they count
  // into an object that keeps nothing.
  await context.addInitScript(`globalThis.${COUNTER_NAME} = new Proxy({}, { get: () => 0, set: () => true })`)
  const page = await context.newPage()
  // The code of the project that the page runs is coverage of the
  // test. This cleanup runs before the one that closes the context.
  await page.coverage.startJSCoverage({ resetOnNavigation: false })
  state.cleanups.push(async () => {
    if (!page.isClosed()) moreCoverage.push(...pageCoverage(await page.coverage.stopJSCoverage(), url ?? STATIC))
  })
  page.on('pageerror', error => {
    if (!state.ended) state.fail({ kind: 'error', message: `an error in the page: ${error.message}` })
  })
  return page
}
