// `ubqtest/browser`: a page of a real browser, and `assert.eventually`.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { assert, cleanup, test } from 'ubqtest'
import { browser } from 'ubqtest/browser'
import { project, remove } from './setup.ts'

// `ubq browser install` downloads the browser. CI runs it.
const installed = existsSync(chromium.executablePath().replace(/chromium-(\d+).*/, 'chromium_headless_shell-$1'))
const skip = installed ? {} : { skip: 'the browser is not installed: node src/cli.ts browser install' }

// The first test of a file starts the browser. On a slow machine
// that takes seconds, so the tests that use it have a long limit.
test('a page loads a file of the project, with a module script', { ...skip, timeout: 30_000 }, async () => {
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
  cleanup(() => remove(p.dir))
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
  cleanup(() => remove(p.dir))
  writeFileSync(join(p.dir, 'page.html'), '<button onclick="setTimeout(() => { throw new Error(\'bad click\') })">go</button>')
  writeFileSync(
    join(p.dir, 'page.test.ts'),
    `import { assert, test } from 'ubqtest'
import { browser } from 'ubqtest/browser'
test('page error', { timeout: 30_000 }, async () => {
  const page = await browser()
  await page.goto('/page.html')
  await page.click('button')
  await assert.eventually(() => page.title(), 'never')
})
test('no element', { timeout: 30_000 }, async () => {
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

// Many runs of `ubq`, each with a browser: slow on a machine with much work.
test('the runner starts the server of the configuration, and stops it', { ...skip, timeout: 120_000 }, () => {
  const p = project()
  cleanup(() => remove(p.dir))
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
test('served', { timeout: 30_000 }, async () => {
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
  const one = p.ubq('served.test.ts')
  assert.equal(one.last, 'pass: 0 failed, 1 passed', one.out + one.err)
  assert.equal(stopped(), true)
  // A run with no browser test does not start the server.
  rmSync(join(p.dir, 'server.pid'))
  assert.equal(p.ubq('pass.ts').code, 0)
  assert.equal(p.ubq('pass.ts', 'mock.ts').last, 'fail: 2 failed, 7 passed, 1 skipped')
  assert.equal(existsSync(join(p.dir, 'server.pid')), false)
  // Two files: the test processes are children of the runner.
  const two = p.ubq('served.test.ts', 'pass.ts')
  assert.deepEqual([two.last, two.err], ['pass: 0 failed, 6 passed, 1 skipped', ''], two.out)
  assert.equal(existsSync(join(p.dir, 'server.pid')), true)
  assert.equal(stopped(), true)

  p.configure({ browser: { url: `http://localhost:${port}`, command: 'node app/absent.js' } })
  const bad = p.ubq('served.test.ts')
  assert.equal(bad.code, 4)
  assert.match(bad.err, /"ubq\.browser\.command" in package\.json \(node app\/absent\.js\) ended with exit code 1\. Its output is in \.ubq[\\/]browser-server\.log/)
  p.configure({ browser: { command: 'x' } })
  assert.match(p.ubq('pass.ts').err, /"ubq\.browser" in package\.json must be an object with "url"/)
})

const APP = `export const add = (a, b) => a + b
export const never = () => 'never'
export const sign = n => (n < 0 ? 'minus' : 'plus')
document.title = String(add(1, 2)) + sign(1)
`

test('the code that a page runs is coverage of the test', { ...skip, timeout: 30_000 }, () => {
  const p = project()
  cleanup(() => remove(p.dir))
  writeFileSync(join(p.dir, 'src/app.js'), APP)
  writeFileSync(join(p.dir, 'page.html'), '<script type="module" src="/src/app.js"></script>')
  writeFileSync(
    join(p.dir, 'app.test.ts'),
    `import { assert, test } from 'ubqtest'
import { browser } from 'ubqtest/browser'
test('title', { timeout: 30_000 }, async () => {
  const page = await browser()
  await page.goto('/page.html')
  await assert.eventually(() => page.title(), '3plus')
})
test('minus', async () => {
  const page = await browser()
  await page.goto('/page.html')
  // The function runs in the page. It has counters of this file in its text.
  assert.equal(await page.evaluate(() => import('/src/app.js').then(m => m.sign(-1))), 'minus')
})
`,
  )
  const first = p.ubq('app.test.ts:3')
  assert.equal(first.last, 'pass: 0 failed, 1 passed, 1 not selected', first.out + first.err)
  assert.deepEqual(p.ubq('uncovered', 'src/app.js').out.split('\n'), [
    "src/app.js:2:22  () => 'never'",
    "src/app.js:3:33  ? 'minus'",
    '2 uncovered ranges in src/app.js',
    '',
  ])
  const both = p.ubq('app.test.ts')
  assert.equal(both.last, 'pass: 0 failed, 2 passed', both.out + both.err)
  assert.deepEqual(p.ubq('uncovered', 'src/app.js').out.split('\n'), ["src/app.js:2:22  () => 'never'", '1 uncovered ranges in src/app.js', ''])
  assert.deepEqual(p.ubq('covers', 'src/app.js:3').out.split('\n'), ['app.test.ts > minus', 'app.test.ts > title', '2 tests run src/app.js:3', ''])
  // A change to code that the pages ran selects the tests. A change
  // to code that no page ran selects none.
  writeFileSync(join(p.dir, 'src/app.js'), APP.replace('a + b', 'b + a'))
  assert.deepEqual(p.ubq('--changed').out.split('\n').slice(0, 2), ['changed: src/app.js', 'pass: 0 failed, 2 passed (run 3)'])
  writeFileSync(join(p.dir, 'src/app.js'), APP.replace('a + b', 'b + a').replace("'never'", "'not one time'"))
  assert.equal(p.ubq('--changed').err, 'ubq: no test ran the code that changed in src/app.js\n')
})

test('a script that a server made from a file has coverage through its source map', { ...skip, timeout: 30_000 }, () => {
  const p = project()
  cleanup(() => remove(p.dir))
  const port = 20000 + ((process.pid + 1) % 20000)
  const esbuild = pathToFileURL(createRequire(import.meta.url).resolve('esbuild')).href
  writeFileSync(
    join(p.dir, 'src/app.ts'),
    `export const add = (a: number, b: number): number => a + b
export const never = (): string => 'never'
// A comment, so that the lines of the script are not the lines of the file.
export const sign = (n: number): string => (n < 0 ? 'minus' : 'plus')
document.title = String(add(1, 2)) + sign(1)
`,
  )
  writeFileSync(
    join(p.dir, 'server.js'),
    `import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { transformSync } from ${JSON.stringify(esbuild)}
createServer((req, res) => {
  if (req.url === '/src/app.ts')
    res.setHeader('content-type', 'text/javascript').end(transformSync(readFileSync('src/app.ts', 'utf8'), { loader: 'ts', sourcemap: 'inline', sourcefile: 'app.ts' }).code)
  else res.setHeader('content-type', 'text/html').end('<script type="module" src="/src/app.ts"></script>')
}).listen(${port})
`,
  )
  writeFileSync(
    join(p.dir, 'app.test.ts'),
    `import { assert, test } from 'ubqtest'
import { browser } from 'ubqtest/browser'
test('title', { timeout: 30_000 }, async () => {
  const page = await browser()
  await page.goto('/')
  await assert.eventually(() => page.title(), '3plus')
})
`,
  )
  p.configure({ browser: { url: `http://localhost:${port}`, command: 'node server.js' } })
  const run = p.ubq('app.test.ts')
  assert.equal(run.last, 'pass: 0 failed, 1 passed', run.out + run.err)
  assert.deepEqual(p.ubq('uncovered', 'src/app.ts').out.split('\n'), [
    "src/app.ts:2:22  (): string => 'never'",
    "src/app.ts:4:53  'minus'",
    '2 uncovered ranges in src/app.ts',
    '',
  ])
})
