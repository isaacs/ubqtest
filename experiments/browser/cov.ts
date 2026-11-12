// Does Chromium give coverage of a script file that a page loads?
// `node cov.ts`
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'

const server = createServer((req, res) => {
  if (req.url === '/app.js') res.setHeader('content-type', 'text/javascript').end('export const a = () => 1\nexport const b = () => 2\ndocument.body.textContent = String(a())\n')
  else res.setHeader('content-type', 'text/html').end('<script type="module" src="/app.js"></script>')
}).listen(0)
const { port } = server.address() as { port: number }
const browser = await chromium.launch()
const page = await browser.newPage()
await page.coverage.startJSCoverage()
await page.goto(`http://localhost:${port}/`)
for (const entry of await page.coverage.stopJSCoverage())
  console.log(entry.url, JSON.stringify(entry.functions.map(f => [f.functionName, f.ranges[0]?.count])))
await browser.close()
server.close()
