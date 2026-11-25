// The `dom` key: a test file gets the DOM of jsdom or of happy-dom
// before it loads.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { cli, project, remove } from './setup.ts'

const bun = spawnSync('bun', ['--version']).status === 0
// The first render of React in a new process is slow on a machine with much work.
const SLOW = 60_000
const modules = fileURLToPath(new URL('../node_modules/', import.meta.url))

// Components of React, with Testing Library. Node does not run JSX:
// the file makes its elements with createElement.
const COMPONENT = `import { fireEvent, render, screen } from '@testing-library/react'
import { createElement as h, useEffect, useState } from 'react'
import { assert, test } from 'ubqtest'

let mounted = 0
const Counter = () => {
  const [n, setN] = useState(0)
  useEffect(() => {
    mounted++
    return () => void mounted--
  }, [])
  return h('button', { onClick: () => setN(n + 1) }, 'count ' + n)
}

test('a component renders, and an event changes it', () => {
  render(h(Counter))
  fireEvent.click(screen.getByRole('button'))
  assert.equal(screen.getByRole('button').textContent, 'count 1')
  assert.equal(mounted, 1)
})

test('the tree of the test before is gone: the library gave its cleanup to the afterEach hook', () => {
  assert.equal(mounted, 0)
  assert.equal(document.body.innerHTML, '')
  render(h(Counter))
  assert.equal(screen.getAllByRole('button').length, 1)
})

test('the globals of a page', async () => {
  assert.equal(window, globalThis)
  assert.equal(location.href, URL_OF_PAGE)
  assert.equal(document.defaultView, window)
  const div = document.createElement('div')
  assert(div instanceof HTMLElement)
  document.body.append(div)
  assert.equal(getComputedStyle(div).display, 'block')
  // An event and a signal of the runtime are not those of the DOM.
  let got = ''
  const controller = new AbortController()
  div.addEventListener('ping', event => (got = event.type), { signal: controller.signal })
  div.dispatchEvent(new Event('ping'))
  assert.equal(got, 'ping')
  localStorage.setItem('a', '1')
  assert.equal(window.localStorage.getItem('a'), '1')
  // A test can give the page a value that the DOM does not have.
  window.matchMedia = () => ({ matches: true }) as MediaQueryList
  assert.equal(matchMedia('(min-width: 1px)').matches, true)
  // fetch takes the signal of the page.
  controller.abort()
  await assert.rejects(fetch('http://127.0.0.1:9/', { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(new Request('http://localhost/', { signal: controller.signal }).signal.aborted, true)
  const later = new AbortController()
  const request = new Request('http://localhost/', { signal: later.signal })
  later.abort()
  assert.equal(request.signal.aborted, true)
  assert.equal(new Request('http://localhost/a').url, 'http://localhost/a')
  // A test can replace fetch.
  globalThis.fetch = async () => new Response('fake')
  assert.equal(await (await fetch('http://localhost/')).text(), 'fake')
  // The timers are those of the runtime.
  assert.equal(setTimeout, (await import('node:timers')).setTimeout)
})
`

const PLAIN = `import { assert, test } from 'ubqtest'
test('a file that the key does not name has no DOM', () => {
  assert.equal(typeof document, 'undefined')
  assert.equal(typeof (globalThis as { afterEach?: unknown }).afterEach, 'undefined')
})
`

/** A project with a component test, a test with no DOM, and the packages for a DOM. */
const domProject = (url = 'http://localhost:3000/') => {
  const p = project()
  cleanup(() => remove(p.dir))
  mkdirSync(join(p.dir, 'node_modules/@testing-library'))
  for (const name of ['jsdom', 'happy-dom', 'react', 'react-dom', '@testing-library/react', '@testing-library/dom'])
    symlinkSync(join(modules, name), join(p.dir, 'node_modules', name), 'junction')
  mkdirSync(join(p.dir, 'ui'))
  writeFileSync(join(p.dir, 'ui/counter.test.ts'), COMPONENT.replace('URL_OF_PAGE', JSON.stringify(url)))
  // The library of ubq loads before Testing Library in this file.
  writeFileSync(
    join(p.dir, 'ui/counter-later.test.ts'),
    COMPONENT.replace('URL_OF_PAGE', JSON.stringify(url)).replace(/^(import .*\n)(import .*\n)(import .*\n)/, '$3$1$2'),
  )
  writeFileSync(join(p.dir, 'ui/plain.test.ts'), PLAIN)
  return p
}

for (const name of ['jsdom', 'happy-dom'])
  test(`${name}: React Testing Library, the globals of a page, and a file with no DOM`, () => {
    const p = domProject()
    p.configure({ dom: { package: name, include: ['ui/counter*'] }, timeout: SLOW })
    const all = p.ubq('ui')
    assert.equal(all.out, 'pass: 7 tests (run 1)\n', all.out + all.err)
    // One file, in the process of the runner.
    const one = p.ubq('ui/counter.test.ts')
    assert.equal(one.out, 'pass: 3 tests (run 2)\n', one.out + one.err)
    if (bun) {
      const onBun = spawnSync('bun', [cli, 'ui'], { cwd: p.dir, encoding: 'utf8' })
      assert.equal(onBun.stdout, 'pass: 7 tests (run 3)\n', onBun.stdout + onBun.stderr)
    }
  })

test('a .tsx test file on Node, with the transform key', () => {
  const p = domProject()
  symlinkSync(join(modules, 'typescript5'), join(p.dir, 'node_modules/typescript'), 'junction')
  p.configure({ dom: { package: 'jsdom', include: ['ui/*.test.tsx'] }, transform: 'typescript', timeout: SLOW })
  // The type check reads only this one file: the project has no types of React.
  writeFileSync(join(p.dir, 'only.d.ts'), 'export {}\n')
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ "compilerOptions": { "jsx": "react-jsx" }, "include": ["only.d.ts"] }')
  writeFileSync(
    join(p.dir, 'ui/Hello.tsx'),
    'export const Hello = ({ name }: { name: string }) => <p role="note">hello {name}</p>\n',
  )
  writeFileSync(
    join(p.dir, 'ui/hello.test.tsx'),
    `import { render, screen } from '@testing-library/react'
import { assert, test } from 'ubqtest'
import { Hello } from './Hello'

test('a component of a .tsx file renders', () => {
  render(<Hello name="a" />)
  assert.equal(screen.getByRole('note').textContent, 'hello a')
})
`,
  )
  const r = p.ubq('ui/hello.test.tsx')
  assert.equal(r.out, 'pass: 1 test (run 1)\n', r.out + r.err)
})

test('the url of the page, a test process of the server, and a key with no include', () => {
  const p = domProject('http://localhost/app')
  p.configure({ dom: { package: 'jsdom', url: 'http://localhost/app' }, timeout: SLOW })
  assert.match(p.ubq('server').out, /^server: pid \d+/)
  cleanup(() => void p.ubq('server', 'stop'))
  const r = p.ubq('ui/counter.test.ts', 'pass.ts')
  assert.equal(r.last, 'pass: 8 tests, 1 skipped', r.out + r.err)
  // With no include, each test file has the DOM.
  const plain = p.ubq('ui/plain.test.ts')
  assert.contains(plain.out, "actual:   'object'\n  expected: 'undefined'")
})

test('a package that the project does not have, a value of the key that is not correct, and doctor', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  p.configure({ dom: { package: 'jsdom' } })
  const hint =
    'the "dom" key of "ubq" in package.json names the package jsdom, and the project does not have it. Install it: npm install --save-dev jsdom'
  const none = p.ubq('pass.ts')
  assert.deepEqual([none.code, none.err], [4, `ubq: ${hint}\n`])
  assert.contains(
    p.ubq('doctor').out,
    'FIX  "ubq.dom" names the package jsdom, and the project does not have it. Run: npm install --save-dev jsdom',
  )
  mkdirSync(join(p.dir, 'node_modules/jsdom'), { recursive: true })
  symlinkSync(join(modules, 'jsdom'), join(p.dir, 'node_modules/jsdom/real'), 'junction')
  writeFileSync(join(p.dir, 'node_modules/jsdom/package.json'), '{ "name": "jsdom", "main": "real/lib/api.js" }')
  assert.contains(p.ubq('doctor').out, 'ok   jsdom, for test files with a DOM')
  for (const dom of [
    { package: 'dom' },
    { package: 'jsdom', include: [] },
    { package: 'jsdom', url: 'page' },
    'jsdom',
  ]) {
    p.configure({ dom })
    const r = p.ubq('pass.ts')
    assert.equal(r.code, 4)
    assert.contains(r.err, '"ubq.dom" in package.json must be an object with "package" ("jsdom" or "happy-dom")')
  }
})

test('ubq convert writes the dom key from the environment of the old config, or from the files that ask for a DOM', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  const test = "import { expect, it } from 'vitest'\nit('a', () => { expect(document.title).toBe('') })\n"
  mkdirSync(join(p.dir, 'old'))
  writeFileSync(join(p.dir, 'old/a.test.ts'), `// @vitest-environment happy-dom\n${test}`)
  writeFileSync(join(p.dir, 'old/b.test.ts'), `import { render } from '@testing-library/react'\n${test}`)
  writeFileSync(join(p.dir, 'old/c.test.ts'), `/** @vitest-environment node */\n${test}`)
  const some = p.ubq('convert', 'old').out
  const key = '"dom": {"package":"happy-dom","include":["old/a.test.ts","old/b.test.ts"]}'
  assert.contains(some, `wrote "ubq.dom" to package.json: ${key}`)
  assert.contains(
    some,
    'note: the "dom" key gives 2 test files the DOM of happy-dom, before the file loads. See: ubq guide dom. The project does not have happy-dom: npm install --save-dev happy-dom',
  )
  assert.deepEqual(JSON.parse(readFileSync(join(p.dir, 'package.json'), 'utf8')).ubq.dom, {
    package: 'happy-dom',
    include: ['old/a.test.ts', 'old/b.test.ts'],
  })
  // The comment went away, and the file has no TODO for a DOM.
  assert.equal(
    readFileSync(join(p.dir, 'old/a.test.ts'), 'utf8').split('\n')[0],
    "import { assert, test } from 'ubqtest'",
  )
  // The environment of a vitest config is for each test file.
  p.configure()
  writeFileSync(join(p.dir, 'vitest.config.ts'), "export default { test: { environment: 'happy-dom' } }\n")
  mkdirSync(join(p.dir, 'node_modules/happy-dom'))
  assert.deepEqual(
    p
      .ubq('convert', '--dry', 'old')
      .out.split('\n')
      .filter(line => line.includes('"dom"')),
    [
      'add to "ubq" in package.json: "dom": {"package":"happy-dom"}',
      'note: the "dom" key gives each test file the DOM of happy-dom, before the file loads. See: ubq guide dom',
    ],
  )
  // Files that import Testing Library, and name no DOM: jsdom.
  writeFileSync(join(p.dir, 'vitest.config.ts'), 'export default {}\n')
  mkdirSync(join(p.dir, 'more'))
  writeFileSync(join(p.dir, 'more/e.test.ts'), `import { render } from '@testing-library/react'\n${test}`)
  assert.contains(
    p.ubq('convert', '--dry', 'more').out,
    'add to "ubq" in package.json: "dom": {"package":"jsdom","include":["more/e.test.ts"]}',
  )
  // The environment of a jest config, with the address of the page of jest.
  writeFileSync(join(p.dir, 'vitest.config.ts'), 'export default {}\n')
  writeFileSync(join(p.dir, 'jest.config.js'), "module.exports = { testEnvironment: 'jest-environment-jsdom' }\n")
  writeFileSync(join(p.dir, 'old/d.spec.js'), "it('a', () => { expect(1).toBe(1) })\n")
  assert.contains(
    p.ubq('convert', '--dry', 'old').out,
    'add to "ubq" in package.json: "dom": {"package":"jsdom","url":"http://localhost/"}',
  )
})
