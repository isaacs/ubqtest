// `ubqtest/browser`: a page of a real browser, and `assert.eventually`.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { assert, cleanup, test } from 'ubqtest'
import { browser } from 'ubqtest/browser'
import { project } from './setup.ts'

// `ubq browser install` downloads the browser. CI runs it.
const installed = existsSync(chromium.executablePath().replace(/chromium-(\d+).*/, 'chromium_headless_shell-$1'))
const skip = installed ? {} : { skip: 'the browser is not installed: node src/cli.ts browser install' }

test('a page loads a file of the project, with a module script', skip, async () => {
  const page = await browser()
  await page.goto('/test/fixtures/browser/page.html')
  await page.click('#b')
  // The text changes 50 ms after the click.
  await assert.eventually(() => page.textContent('#b'), '1')
  assert.equal((await page.goto('/no-such-file.html'))?.status(), 404)
  assert.equal((await page.goto('/../outside'))?.status(), 404)
})

test('eventually: a value that never matches fails with the last value', { timeout: 20_000 }, () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(
    join(p.dir, 'wait.test.ts'),
    `import { assert, test } from 'ubqtest'
test('never', async () => {
  let n = 0
  await assert.eventually(() => ({ n: ++n > 0 ? 1 : 0, more: true }), { n: 2 })
})
test('not awaited', () => {
  assert.eventually(() => 1, 1)
})
test('later', async () => {
  const from = Date.now()
  await assert.eventually(async () => Date.now() - from > 100, true)
})
`,
  )
  const r = p.ubq('wait.test.ts')
  assert.match(r.out, /FAIL wait\.test\.ts > never\n  the value did not match the pattern in 2000 ms\n/)
  assert.match(r.out, /n: 1 → 2|actual: +1/)
  assert.match(r.out, /FAIL wait\.test\.ts > not awaited\n/)
  assert.equal(r.last, 'fail: 2 failed, 1 passed')
})

test('an error in the page fails the test, and a missing element names the element', { ...skip, timeout: 30_000 }, () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(join(p.dir, 'page.html'), '<button onclick="setTimeout(() => { throw new Error(\'bad click\') })">go</button>')
  writeFileSync(
    join(p.dir, 'page.test.ts'),
    `import { assert, test } from 'ubqtest'
import { browser } from 'ubqtest/browser'
test('page error', async () => {
  const page = await browser()
  await page.goto('/page.html')
  await page.click('button')
  await assert.eventually(() => page.title(), 'never')
})
test('no element', async () => {
  const page = await browser()
  await page.goto('/page.html')
  await page.click('#absent')
})
`,
  )
  const r = p.ubq('page.test.ts')
  assert.match(r.out, /FAIL page\.test\.ts > page error\n  an error in the page: bad click\n/)
  assert.match(r.out, /FAIL page\.test\.ts > no element\n  .*Timeout 2000ms exceeded/)
  assert.match(r.out, /waiting for locator\('#absent'\)/)
  assert.equal(r.code, 1)
})

test('the runner starts the server of the configuration, and stops it', { ...skip, timeout: 30_000 }, () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  const port = 20000 + (process.pid % 20000)
  mkdirSync(join(p.dir, 'app'))
  writeFileSync(
    join(p.dir, 'app/server.js'),
    `import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
writeFileSync('server.pid', String(process.pid))
createServer((req, res) => res.setHeader('content-type', 'text/html').end('<title>served ' + req.url + '</title>')).listen(${port})
`,
  )
  writeFileSync(
    join(p.dir, 'served.test.ts'),
    `import { assert, test } from 'ubqtest'
import { browser } from 'ubqtest/browser'
test('served', async () => {
  const page = await browser()
  await page.goto('/a')
  assert.equal(await page.title(), 'served /a')
})
`,
  )
  p.configure({ browser: { url: `http://localhost:${port}`, command: 'node app/server.js' } })
  /** Waits until nothing answers at the URL. True if that came in 5 seconds. */
  const stopped = (): boolean =>
    spawnSync('node', [
      '-e',
      `const end = Date.now() + 5000
const check = () => fetch('http://localhost:${port}').then(() => (Date.now() > end ? process.exit(1) : setTimeout(check, 50)), () => process.exit(0))
check()`,
    ]).status === 0
  assert.equal(p.ubq('served.test.ts').last, 'pass: 0 failed, 1 passed')
  assert.equal(stopped(), true)
  // A run with no browser test does not start the server.
  rmSync(join(p.dir, 'server.pid'))
  assert.equal(p.ubq('pass.ts').code, 0)
  assert.equal(existsSync(join(p.dir, 'server.pid')), false)
  // Two files: the test processes are children of the runner.
  const two = p.ubq('served.test.ts', 'pass.ts')
  assert.deepEqual([two.last, two.err], ['pass: 0 failed, 2 passed', ''], two.out)
  assert.equal(existsSync(join(p.dir, 'server.pid')), true)
  assert.equal(stopped(), true)

  p.configure({ browser: { url: `http://localhost:${port}`, command: 'node app/absent.js' } })
  const bad = p.ubq('served.test.ts')
  assert.equal(bad.code, 4)
  assert.match(bad.err, /"ubq\.browser\.command" in package\.json \(node app\/absent\.js\) ended with exit code 1\. Its output is in \.ubq[\\/]browser-server\.log/)
  p.configure({ browser: { command: 'x' } })
  assert.match(p.ubq('pass.ts').err, /"ubq\.browser" in package\.json must be an object with "url"/)
})
