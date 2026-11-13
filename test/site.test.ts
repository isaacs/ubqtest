// The web site that `npm run site` makes.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'

const root = fileURLToPath(new URL('..', import.meta.url))

test('each page has a markdown copy, and each link of the site goes to a file', { timeout: 30_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ubq-site-'))
  cleanup(() => rmSync(dir, { recursive: true }))
  const made = spawnSync('node', ['scripts/site.ts', dir], { cwd: root, encoding: 'utf8' })
  assert.deepEqual([made.status, made.stderr], [0, ''])

  const files = (readdirSync(dir, { recursive: true }) as string[]).map(f => f.replace(/\\/g, '/'))
  const pages = files.filter(f => f.endsWith('index.html'))
  assert(pages.length > 10)
  const missing: string[] = []
  for (const page of pages) {
    const copy = page === 'index.html' ? 'index.md' : `${dirname(page)}.md`
    if (!files.includes(copy)) missing.push(`${page}: no ${copy}`)
  }
  for (const file of files.filter(f => /\.(html|md|txt)$/.test(f))) {
    const text = readFileSync(join(dir, file), 'utf8')
    const links = file.endsWith('.html') ? text.matchAll(/(?:href|src)="([^"#]+)/g) : text.matchAll(/\]\(([^)#\s]+)/g)
    for (const [, href = ''] of links) {
      // `/` is the base of the links of 404.html.
      if (/^[a-z]+:/.test(href) || href === '/') continue
      // A path from the root of the host.
      const to = href.startsWith('/') ? join(dir, href) : resolve(dir, dirname(file), href)
      if (!existsSync(to) || (href.endsWith('/') && !existsSync(join(to, 'index.html')))) missing.push(`${file}: ${href}`)
    }
  }
  assert.deepEqual(missing, [])
  assert.match(readFileSync(join(dir, '404.html'), 'utf8'), /<base href="\/">[^]*href="guide\/"/)
  // The number of a decision is a link to the heading of the decision.
  const to = /href="\.\.\/docs\/decisions\/#(d24-[^"]+)">D24<\/a>/.exec(readFileSync(join(dir, 'config/index.html'), 'utf8'))
  assert(to, 'a link for D24')
  assert(readFileSync(join(dir, 'docs/decisions/index.html'), 'utf8').includes(`<h2 id="${to[1]}">D24. `))
  // Code text with `<` stays text.
  assert.match(readFileSync(join(dir, 'guide/index.html'), 'utf8'), /<code>ubq &lt;file&gt;:&lt;line&gt;<\/code>|&lt;test id&gt;/)
  assert.match(readFileSync(join(dir, 'guide/index.html'), 'utf8'), /<link rel="alternate" type="text\/markdown" href="\.\.\/guide\.md"/)
  // A link preview needs the full URL of the page and of an image.
  const guide = readFileSync(join(dir, 'guide/index.html'), 'utf8')
  assert(guide.includes('<meta property="og:url" content="https://ubq.dev/guide/">'))
  assert(guide.includes('<meta property="og:image" content="https://ubq.dev/static/logo-1200x1200.png">'))
  assert(existsSync(join(dir, 'static/logo-1200x1200.png')))
})
