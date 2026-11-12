// What does Playwright cost, and does it work on each runtime?
// `node pw.ts`, `bun pw.ts`, `deno run -A pw.ts`.
import { chromium } from 'playwright-core'

const PAGE = `<button id="b">0</button><script>
  const b = document.getElementById('b')
  b.onclick = () => setTimeout(() => { b.textContent = String(Number(b.textContent) + 1) }, 50)
</script>`
const ms = (from: number): string => (performance.now() - from).toFixed(0) + ' ms'
const out: Record<string, string> = {}

let t = performance.now()
const browser = await chromium.launch()
out.launch = ms(t)

t = performance.now()
const page = await browser.newPage()
out.newPage = ms(t)

const errors: string[] = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => m.type() === 'error' && errors.push(m.text()))

t = performance.now()
await page.setContent(PAGE)
await page.coverage.startJSCoverage()
await page.click('#b')
// The text changes 50 ms after the click. The locator waits for it.
await page.getByText('1', { exact: true }).waitFor()
out.clickAndWait = ms(t)
await page.evaluate(() => { setTimeout(() => { throw new Error('page failure') }) })
await page.waitForTimeout(50)
out.errors = JSON.stringify(errors)
out.coverage = String((await page.coverage.stopJSCoverage()).length) + ' scripts'

t = performance.now()
const context = await browser.newContext()
const second = await context.newPage()
await second.setContent(PAGE)
await context.close()
out.secondContextAndPage = ms(t)

t = performance.now()
await browser.close()
out.close = ms(t)

// A browser that a different process started.
const server = await chromium.launchServer()
t = performance.now()
const remote = await chromium.connect(server.wsEndpoint())
const p = await remote.newPage()
await p.setContent(PAGE)
out.connectAndPage = ms(t)
await remote.close()
await server.close()

console.log(out)
