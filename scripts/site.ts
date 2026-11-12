// Makes the web site in `_site/`: static HTML, and a markdown copy of
// each page for agents. `node scripts/site.ts <folder>` makes it in a
// different folder.
//
// Each link in the output is relative, so the site works at any URL
// and from a folder of a disk.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Marked, type Tokens } from 'marked'

const root = fileURLToPath(new URL('../', import.meta.url))
const out = resolve(process.argv[2] ?? resolve(root, '_site'))
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string; description: string }
const REPO = 'https://github.com/isaacs/ubqtest'

interface Page {
  /** The markdown file, from the root of the repository. */
  source: string
  /** The place in the site: `<slug>/index.html` and `<slug>.md`. */
  slug: string
  /** The name in menus. */
  name: string
  /** One line for the lists of pages. */
  about: string
  group: 'use' | 'design'
}

const PAGES: Page[] = [
  { source: 'GUIDE.md', slug: 'guide', name: 'Guide', about: 'How to write and run tests: the API, the rules, and the commands.', group: 'use' },
  { source: 'docs/api.md', slug: 'api', name: 'API reference', about: 'Each export of the package, with its type.', group: 'use' },
  { source: 'CONVERT.md', slug: 'convert', name: 'Convert a project', about: 'How to move a project from tap, node:test, vitest, jest, or mocha.', group: 'use' },
  { source: 'docs/08-config.md', slug: 'config', name: 'Configuration', about: 'Which files ubq runs, and the `ubq` key of `package.json`.', group: 'use' },
  { source: 'skills/use-ubq/SKILL.md', slug: 'skill', name: 'Agent skill', about: 'The `use-ubq` skill that `ubq skill` writes for Claude Code.', group: 'use' },
  { source: 'LICENSE.md', slug: 'license', name: 'License', about: 'Blue Oak Model License 1.0.0.', group: 'use' },
  { source: 'docs/02-decisions.md', slug: 'docs/decisions', name: 'Decisions', about: 'Each design decision, with its reason.', group: 'design' },
  { source: 'docs/04-architecture.md', slug: 'docs/architecture', name: 'Architecture', about: 'The parts, the process model, events, coverage, and the store.', group: 'design' },
  { source: 'docs/03-measurements.md', slug: 'docs/measurements', name: 'Measurements', about: 'The measured costs that the design depends on.', group: 'design' },
  { source: 'docs/05-api.md', slug: 'docs/api-design', name: 'API design', about: 'The test file API, and what is absent on purpose.', group: 'design' },
  { source: 'docs/06-events.md', slug: 'docs/events', name: 'Events', about: 'The events that a test process sends to the runner.', group: 'design' },
  { source: 'docs/11-server.md', slug: 'docs/server', name: 'Server', about: 'The optional background server.', group: 'design' },
  { source: 'docs/10-bun-coverage-api.md', slug: 'docs/bun-coverage', name: 'Coverage on Bun', about: 'What ubq needs from Bun for coverage of each test.', group: 'design' },
  { source: 'docs/01-agent-ideation.md', slug: 'docs/agent-needs', name: 'What agents need', about: 'What an agent needs from a test tool. Written by an agent, before the design.', group: 'design' },
  { source: 'docs/00-initial-prompt.md', slug: 'docs/goals', name: 'Goals', about: 'The goals of the project, from its author.', group: 'design' },
  { source: 'docs/07-status.md', slug: 'docs/status', name: 'Status', about: 'What is built, and the known limits.', group: 'design' },
  { source: 'docs/09-questions.md', slug: 'docs/questions', name: 'Open questions', about: 'Points that wait for a decision.', group: 'design' },
]
const HOME = { source: 'README.md', slug: 'index' }
const DOCS = { source: 'docs/README.md', slug: 'docs' }
const bySource = new Map<string, string>([HOME, DOCS, ...PAGES].map(p => [p.source, p.slug]))

const read = (file: string): string => readFileSync(resolve(root, file), 'utf8')
const write = (file: string, text: string): void => {
  mkdirSync(dirname(resolve(out, file)), { recursive: true })
  writeFileSync(resolve(out, file), text)
}
const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The file of a page in the site. */
const htmlFile = (slug: string): string => (slug === 'index' ? 'index.html' : `${slug}/index.html`)
/** A relative URL from the file of one page to a file of the site. */
const rel = (fromSlug: string, to: string): string => {
  const url = posix.relative(posix.dirname(htmlFile(fromSlug)), to) || '.'
  return url.endsWith('index.html') ? url.slice(0, -'index.html'.length) || './' : url
}
/** The same, for the markdown copy of a page. All copies are `<slug>.md`. */
const relMd = (fromSlug: string, to: string): string => posix.relative(posix.dirname(`${fromSlug}.md`), to)

/**
 * The URL in the site for a link of a markdown source. A link to a
 * file that is not a page goes to the repository.
 */
const link = (page: { source: string; slug: string }, href: string, markdown: boolean): string => {
  if (/^([a-z]+:|#)/i.test(href)) return href
  const [path = '', hash] = href.split('#')
  const file = posix.normalize(posix.join(posix.dirname(page.source), path))
  const slug = bySource.get(file)
  if (slug === undefined) return `${REPO}/blob/main/${file}${hash ? '#' + hash : ''}`
  const url = markdown ? relMd(page.slug, `${slug}.md`) : rel(page.slug, htmlFile(slug))
  return url + (hash ? '#' + hash : '')
}

// The files and folders that git tracks.
const tracked = new Set<string>()
for (const file of spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean)) {
  tracked.add(file)
  for (let dir = posix.dirname(file); dir !== '.'; dir = posix.dirname(dir)) tracked.add(dir + '/')
}

/**
 * The URL for a path in code text, such as `02-decisions.md`,
 * `src/events.ts`, `src/runner.ts:12`, or `experiments/`. A document
 * of the site goes to its page. A different file or folder that git
 * tracks goes to the repository. The path is from the folder of the
 * source, from the root, from `docs/`, or from `experiments/`.
 *
 * A name with no folder is a link only if it is a markdown file: a
 * name such as `package.json` is usually a file of the reader's
 * project. Undefined if the text is not such a path, or if it is the
 * page itself.
 */
const mention = (page: { source: string; slug: string }, text: string): string | undefined => {
  const [, path = '', line] = /^(\w[\w./-]*?)(?::(\d+))?$/.exec(text) ?? []
  if (!path.includes('/') && !path.endsWith('.md')) return undefined
  for (const base of [posix.dirname(page.source), '.', 'docs', 'experiments']) {
    const file = posix.normalize(posix.join(base, path))
    if (file === page.source || file.startsWith('..')) continue
    if (bySource.has(file)) return link({ source: 'x', slug: page.slug }, file, false)
    const folder = file.replace(/\/?$/, '/')
    if (tracked.has(folder)) return `${REPO}/tree/main/${folder.slice(0, -1)}`
    if (tracked.has(file)) return `${REPO}/blob/main/${file}${line ? '#L' + line : ''}`
  }
  return undefined
}

const KEYWORDS = new Set(
  'as async await break case catch class const continue default do else export extends false finally for from function if import in instanceof interface let new null of return satisfies switch this throw true try type typeof undefined void while'.split(' '),
)
const TS = /(\/\/.*|\/\*[^]*?\*\/)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\[^])*`)|\b(\d[\d_.]*)\b|([A-Za-z_$][\w$]*)/g
/** TypeScript with a `span` for each comment, string, number, and keyword. */
const typescript = (code: string): string => {
  let html = ''
  let last = 0
  for (const m of code.matchAll(TS)) {
    const kind = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : KEYWORDS.has(m[0]) ? 'k' : ''
    html += escape(code.slice(last, m.index))
    html += kind ? `<span class="${kind}">${escape(m[0])}</span>` : escape(m[0])
    last = m.index + m[0].length
  }
  return html + escape(code.slice(last))
}
/** Output of ubq, with a `span` for the first word of a report line. */
const terminal = (code: string): string =>
  escape(code)
    .replace(/^(FAIL|ERROR|TYPE|SURVIVED|fail:)/gm, '<span class="bad">$1</span>')
    .replace(/^(pass:)/gm, '<span class="good">$1</span>')
    .replace(/^(\$ )(.*)$/gm, '<span class="c">$1</span><span class="cmd">$2</span>')

const code = (text: string, lang = ''): string =>
  `<pre class="${lang ? 'lang-' + escape(lang) : 'plain'}"><code>${/^[jt]sx?$/.test(lang) ? typescript(text) : lang ? escape(text) : terminal(text)}</code></pre>\n`

/** The HTML of a markdown source, and its first heading. */
const render = (page: { source: string; slug: string }, markdown: string): { html: string; title: string } => {
  const ids = new Map<string, number>()
  let title = ''
  const marked = new Marked({
    walkTokens: token => {
      if (token.type === 'link') {
        token.href = link(page, token.href, false)
        for (const child of token.tokens ?? []) if (child.type === 'codespan') (child as { linked?: boolean }).linked = true
      }
    },
    renderer: {
      code: ({ text, lang }: Tokens.Code) => code(text, lang),
      // A path of the repository, in code text, is a link.
      codespan: ({ text, linked }: Tokens.Codespan & { linked?: boolean }) => {
        const href = linked ? undefined : mention(page, text)
        return href ? `<a href="${href}"><code>${text}</code></a>` : `<code>${text}</code>`
      },
      heading(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, { tokens, depth, text }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens)
        if (depth === 1) {
          title ||= text.replace(/`/g, '')
          return `<h1>${inner}</h1>\n`
        }
        const base = text.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'section'
        const count = ids.get(base) ?? 0
        ids.set(base, count + 1)
        const id = count ? `${base}-${count}` : base
        return `<h${depth} id="${id}">${inner}<a class="selflink" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`
      },
    },
  })
  const html = (marked.parse(markdown.replace(/^---\n[^]*?\n---\n/, '')) as string)
    .replace(/<table>/g, '<div class="table"><table>')
    .replace(/<\/table>/g, '</table></div>')
  return { html, title }
}

/** The markdown copy of a source: the same text, with links of the site. */
const markdownCopy = (page: { source: string; slug: string }, markdown: string): string =>
  markdown.replace(/(?<=\]\()([^)\s]+)(?=\))/g, href => link(page, href, true))

const NAV: [name: string, to: string][] = [
  ['Guide', 'guide/index.html'],
  ['API', 'api/index.html'],
  ['Convert', 'convert/index.html'],
  ['Docs', 'docs/index.html'],
  ['llms.txt', 'llms.txt'],
]

/** A full HTML document. */
const layout = (slug: string, title: string, body: string, bodyClass: string): string => {
  const current = (to: string): string => (htmlFile(slug) === to || (to === 'docs/index.html' && slug.startsWith('docs/')) ? ' class="current-page"' : '')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(pkg.description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ubq">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(pkg.description)}">
<meta name="twitter:card" content="summary">
<link rel="icon" type="image/svg+xml" href="${rel(slug, 'static/logo.svg')}">
<link rel="stylesheet" href="${rel(slug, 'static/style.css')}">
<link rel="alternate" type="text/markdown" href="${rel(slug, slug + '.md')}" title="This page as markdown">
<link rel="alternate" type="text/plain" href="${rel(slug, 'llms.txt')}" title="Index of the documents, for agents">
</head>
<body class="${bodyClass}">
<header id="top">
  <a class="brand" href="${rel(slug, 'index.html')}"><img src="${rel(slug, 'static/logo.svg')}" alt="" width="40" height="40"><span>ubq</span> <small>${escape(pkg.version)}</small></a>
  <nav aria-label="Site">
    <ul>
${NAV.map(([name, to]) => `      <li${current(to)}><a href="${rel(slug, to)}">${name}</a></li>`).join('\n')}
      <li><a href="${REPO}">GitHub</a></li>
    </ul>
  </nav>
</header>
${body}
<footer>
  <p><strong>For agents:</strong> each page of this site is also a markdown file. This page: <a href="${rel(slug, slug + '.md')}">${slug}.md</a>. The index: <a href="${rel(slug, 'llms.txt')}">llms.txt</a>. All the user documents in one file: <a href="${rel(slug, 'llms-full.txt')}">llms-full.txt</a>.</p>
  <p>ubq ${escape(pkg.version)}. <a href="${rel(slug, 'license/index.html')}">Blue Oak Model License 1.0.0</a>.</p>
</footer>
</body>
</html>
`
}

/** The menu of the document pages. */
const side = (slug: string): string => {
  const list = (group: Page['group']): string =>
    PAGES.filter(p => p.group === group)
      .map(p => `      <li${p.slug === slug ? ' class="current-page"' : ''}><a href="${rel(slug, htmlFile(p.slug))}">${p.name}</a></li>`)
      .join('\n')
  return `<nav class="side" aria-label="Documents">
    <h2>Use ubq</h2>
    <ul>
${list('use')}
    </ul>
    <h2><a href="${rel(slug, 'docs/index.html')}">Design</a></h2>
    <ul>
${list('design')}
    </ul>
  </nav>`
}

/** Writes a document page: the HTML and the markdown copy. */
const documentPage = (page: { source: string; slug: string }, markdown: string): void => {
  const { html, title } = render(page, markdown)
  const body = `<div class="columns">
  ${side(page.slug)}
  <main class="doc">
    <p class="as-markdown"><a href="${rel(page.slug, page.slug + '.md')}">This page as markdown</a></p>
${html}
  </main>
</div>`
  write(htmlFile(page.slug), layout(page.slug, `${title} | ubq`, body, 'page'))
  write(`${page.slug}.md`, markdownCopy(page, markdown))
}

rmSync(out, { recursive: true, force: true })
cpSync(resolve(root, 'site/static'), resolve(out, 'static'), { recursive: true })

for (const page of PAGES) documentPage(page, read(page.source))

// The index of the design documents. The links are from `docs/`, the
// folder of the source that this page is in the place of.
const rows = (group: Page['group']): string =>
  PAGES.filter(p => p.group === group)
    .map(p => `- [${p.name}](${posix.relative('docs', p.source)}): ${p.about}`)
    .join('\n')
documentPage(
  DOCS,
  `# Documents

## Use ubq

${rows('use')}

## Design

These documents record how ubq was designed and built: the
decisions and their reasons, the measurements, and the status of
the work. Agents and people wrote them during the work, for the
agents and people who maintain the tool.

${rows('design')}
`,
)

// The home page. Its markdown copy is the README.
const home = read('site/home.html')
  .replace(/\{\{version\}\}/g, escape(pkg.version))
  .replace(/<pre class="(ts|plain)"><code>([^]*?)<\/code><\/pre>/g, (_, lang: string, text: string) => {
    const raw = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    return code(raw, lang === 'ts' ? 'ts' : '').trimEnd()
  })
write('index.html', layout('index', 'ubq: the test tool for coding agents, and their humans', home, 'index'))
write('index.md', markdownCopy(HOME, read(HOME.source)))

// The index for agents (https://llmstxt.org), and the user documents
// in one file.
const entries = (group: Page['group']): string =>
  PAGES.filter(p => p.group === group)
    .map(p => `- [${p.name}](${p.slug}.md): ${p.about}`)
    .join('\n')
write(
  'llms.txt',
  `# ubq

> ubq is a test tool for TypeScript and JavaScript, made for coding agents and the people who work with them. The package is \`ubqtest\`. The command is \`ubq\`. It runs on Node 24 or later, Bun, and Deno. This index is for version ${pkg.version}.

Each page of this site is also a markdown file: \`<page>.md\`. In a project that has the package, \`npx ubq guide\` prints the guide for the installed version. Use that text if it is available, because it is correct for that version.

ubq has no \`it\`, no \`expect\`, no hooks, and no \`.only\`. Read the guide before you write a test.

## Documents

- [Overview](index.md): what ubq is, the commands, and the limits.
${entries('use')}
- [All of the above in one file](llms-full.txt)

## Optional

${entries('design')}
`,
)
write(
  'llms-full.txt',
  [HOME, ...PAGES.filter(p => p.group === 'use' && p.slug !== 'license')]
    .map(p => markdownCopy({ source: p.source, slug: 'index' }, read(p.source)).replace(/^---\n[^]*?\n---\n/, '').trim())
    .join('\n\n---\n\n') + '\n',
)

console.log(`site: ${PAGES.length + 2} pages in ${out}`)
