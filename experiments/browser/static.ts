// Does a page from a file run a module script? And can a route of
// Playwright give files to a page with no server?
// `node static.ts`
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const dir = new URL('./static/', import.meta.url)
const browser = await chromium.launch()
const page = await browser.newPage()
const errors: string[] = []
page.on('console', m => m.type() === 'error' && errors.push(m.text()))
await page.goto(new URL('page.html', dir).href)
await page.waitForTimeout(100)
console.log('file:', JSON.stringify(await page.title()), await page.textContent('body'), errors)

const context = await browser.newContext({ baseURL: 'http://localhost/' })
let t = performance.now()
await context.route('http://localhost/**', async route => {
  const path = fileURLToPath(new URL('.' + new URL(route.request().url()).pathname, dir))
  await route.fulfill({ path }).catch(() => route.fulfill({ status: 404 }))
})
const routed = await context.newPage()
await routed.goto('/page.html')
await routed.waitForFunction(() => document.title !== '')
console.log('route:', JSON.stringify(await routed.title()), (performance.now() - t).toFixed(0), 'ms')
await browser.close()
