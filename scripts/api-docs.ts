// Makes `docs/api.md` from the type declarations of the built
// package: each export of `ubqtest`, with its doc comment.
//   node scripts/api-docs.ts            writes the file (needs `npm run build`)
//   node scripts/api-docs.ts --check    exit code 1 if the file is not current
//   node scripts/api-docs.ts --check <folder>   the declarations are in that folder
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const check = process.argv[2] === '--check'
const types = (check ? process.argv[3] : process.argv[2]) ?? join(root, 'dist/types')
const target = join(root, 'docs/api.md')

interface Item {
  name: string
  comment: string
  code: string
}

// A line at column 0 with one of these starts a new item. Each
// other line is a part of the item before it.
const START = /^(export |declare |type |interface |import |\/\*\*)/
const NAME = /^(?:export )?(?:declare )?(?:const|function|interface|type|class|abstract class) (\w+)/

/** The declarations of a `.d.ts` file, by name. */
const items = (file: string): Map<string, Item> => {
  const out = new Map<string, Item>()
  let comment: string[] = []
  let code: string[] = []
  const end = (): void => {
    const name = NAME.exec(code[0] ?? '')?.[1]
    if (name)
      out.set(name, {
        name,
        comment: comment
          .map(l => l.replace(/^\s*\/?\*+\/?\s?/, '').replace(/\s*\*\/$/, ''))
          .join('\n')
          .trim(),
        code: code
          .join('\n')
          .replace(/^export (declare )?/, '')
          .replace(/^declare /, '')
          .trimEnd(),
      })
    if (code.length) comment = []
    code = []
  }
  let inComment = false
  for (const line of readFileSync(join(types, file), 'utf8').split('\n')) {
    if (inComment) {
      comment.push(line)
      inComment = !line.includes('*/')
    } else if (line.startsWith('/**')) {
      end()
      comment = [line]
      inComment = !line.includes('*/')
    } else if (START.test(line)) {
      end()
      code = [line]
    } else if (code.length) code.push(line)
  }
  end()
  return out
}

const values: Item[] = []
const typeItems: Item[] = []
const index = readFileSync(join(types, 'index.d.ts'), 'utf8')
for (const m of index.matchAll(/^export \{([^}]*)\} from '\.\/(\w[\w-]*)\.(?:ts|js)';$/gm)) {
  const found = items(`${m[2]}.d.ts`)
  for (const part of m[1]!
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)) {
    const isType = part.startsWith('type ')
    const item = found.get(part.replace(/^type /, ''))
    if (!item) throw new Error(`no declaration of ${part} in ${m[2]}.d.ts`)
    ;(isType ? typeItems : values).push(item)
  }
}
for (const item of items('index.d.ts').values()) values.push(item)
/**
 * The count of the types that the package exports. The types after them
 * are those that the signatures use.
 */
const exportedTypes = typeItems.length

// The types that the items use and that the package does not
// export, such as `Test`: the reader needs them too.
const declared = new Map<string, Item>()
for (const file of readdirSync(types).sort())
  if (file.endsWith('.d.ts')) for (const [name, item] of items(file)) if (!declared.has(name)) declared.set(name, item)
const listed = new Set([...values, ...typeItems].map(item => item.name))
const queue = [...values, ...items('browser.d.ts').values(), ...items('workers.d.ts').values(), ...typeItems]
for (let item = queue.shift(); item; item = queue.shift()) {
  // Not the words of a comment or of text in quotes.
  const code = item.code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '')
  for (const [name] of code.matchAll(/\b[A-Z]\w*\b/g)) {
    const found = declared.get(name)
    if (!found || listed.has(name)) continue
    listed.add(name)
    typeItems.push(found)
    queue.push(found)
  }
}

/** The entry points of the package, and the values of each. */
const entries: [name: string, values: Item[]][] = [
  ['ubqtest', values],
  ['ubqtest/browser', [...items('browser.d.ts').values()]],
  ['ubqtest/workers', [...items('workers.d.ts').values()]],
]
const exported = new Set(typeItems.slice(0, exportedTypes).map(item => item.name))

interface Member {
  /** Empty for a call signature. */
  name: string
  comment: string
  /** One element for each overload. */
  code: string[]
  /** The text of the fix, for a name that ubq does not have. */
  hint?: string
}

/**
 * The members of an interface, from its declaration. Undefined for a
 * different item.
 */
const members = (item: Item): Member[] | undefined => {
  if (!item.code.startsWith('interface ')) return undefined
  const out: Member[] = []
  let comment: string[] = []
  let inComment = false
  let last: string[] | undefined
  for (const line of item.code.split('\n').slice(1, -1)) {
    const text = line.slice(4)
    if (inComment || text.startsWith('/**')) {
      comment.push(text)
      inComment = !text.includes('*/')
      last = undefined
    } else if (last && /^[\s})]/.test(text)) last[last.length - 1] += `\n${text}`
    else {
      const name = /^(?:readonly )?(\[[^\]]+\]|\w+)/.exec(text)?.[1] ?? ''
      const hint = /^\w+: Hint<(['"])(.*)\1>;$/.exec(text)?.[2]
      const same = out.find(member => member.name === name)
      if (same) same.code.push(text)
      else
        out.push({
          name,
          comment: comment
            .map(l => l.replace(/^\s*\/?\*+\/?\s?/, '').replace(/\s*\*\/$/, ''))
            .join('\n')
            .trim(),
          code: [text],
          ...(hint && { hint }),
        })
      last = same?.code ?? out.at(-1)!.code
      comment = []
    }
  }
  return out
}

const byName = <T extends { name: string }>(list: T[]): T[] =>
  list.toSorted((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name))

/** A part of the page: a heading, and the text below it. */
interface Part {
  depth: number
  title: string
  body: string[]
}

const fence = (code: string): string[] => ['```ts', code, '```', '']

/**
 * The parts of an item. An interface with doc comments on its
 * members has a part for each member, in the order of the
 * alphabet. `as` is the name of the value that has the type of the
 * interface: its members are `assert.equal`, not `Assert.equal`.
 */
const parts = (item: Item, as?: Item): Part[] => {
  const list = members(item)
  const shown = as ?? item
  const head: Part = { depth: 3, title: `\`${shown.name}\``, body: shown.comment ? [shown.comment, ''] : [] }
  if (!as && !list?.some(member => member.comment)) {
    head.body.push(...fence(item.code))
    return [head]
  }
  const out = [head]
  // The call of the value itself. With a doc comment, it is a part
  // of its own, before the methods.
  for (const call of list!.filter(member => !member.name)) {
    const code = fence(call.code.map(code => `${shown.name}${code}`).join('\n'))
    if (call.comment) out.push({ depth: 4, title: `\`${shown.name}()\``, body: [call.comment, '', ...code] })
    else head.body.push(...code)
  }
  const named = byName(list!.filter(member => member.name && !member.hint))
  for (const member of named)
    out.push({
      depth: 4,
      title: `\`${shown.name}.${member.name}\``.replace('.[', '['),
      body: [
        ...(member.comment ? [member.comment, ''] : []),
        ...fence(member.code.map(code => (as ? `${as.name}.${code}` : code)).join('\n')),
      ],
    })
  const hints = byName(list!.filter(member => member.hint))
  if (hints.length)
    out.push({
      depth: 4,
      title: `Names that \`${shown.name}\` does not have`,
      body: [
        'Each of these names is a compile error, with the name to use in its place.',
        '',
        '| Name | Use |',
        '| --- | --- |',
        ...hints.map(member => `| \`${shown.name}.${member.name}\` | ${member.hint!.replace(/[<|]/g, '\\$&')} |`),
        '',
      ],
    })
  return out
}

/**
 * The type of a value, if it is an interface of the package: `const
 * assert: Assert`.
 */
const typeOf = (item: Item): Item | undefined => {
  const name = /^const \w+: (\w+);$/.exec(item.code)?.[1]
  const type = name ? declared.get(name) : undefined
  return type && members(type) ? type : undefined
}

const page: Part[] = []
/** The value that has each interface as its type. */
const valueOf = new Map<string, Item>()
for (const [name, list] of entries) {
  page.push({ depth: 2, title: `\`${name}\``, body: [`Import from \`'${name}'\`.`, ''] })
  for (const item of byName(list)) {
    const type = typeOf(item)
    if (type) valueOf.set(type.name, item)
    page.push(...(type ? parts(type, item) : parts(item)))
  }
}
const typePart = (item: Item): Part[] => {
  const value = valueOf.get(item.name)
  return value
    ? [
        {
          depth: 3,
          title: `\`${item.name}\``,
          body: [`The type of [\`${value.name}\`](#${value.name.toLowerCase()}). Its members are in that part.`, ''],
        },
      ]
    : parts(item)
}
page.push({ depth: 2, title: 'Types', body: ['The types that the package exports.', ''] })
for (const item of byName(typeItems.filter(item => exported.has(item.name)))) page.push(...typePart(item))
page.push({
  depth: 2,
  title: 'Types of the signatures',
  body: ['The package does not export these types. The signatures above', 'use them, so a reader needs them.', ''],
})
for (const item of byName(typeItems.filter(item => !exported.has(item.name)))) page.push(...typePart(item))

// The ids that the site gives to the headings: the text in small
// letters, with `-` for each other character, and a number for a
// second heading with the same text.
const seen = new Map<string, number>()
const id = (title: string): string => {
  const base =
    title
      .toLowerCase()
      .replace(/[^\w]+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  const count = seen.get(base) ?? 0
  seen.set(base, count + 1)
  return count ? `${base}-${count}` : base
}
id('Contents')
const contents: string[] = []
for (const part of page) {
  const link = `[${part.title}](#${id(part.title)})`
  if (part.depth === 2) contents.push(`- ${link}`)
  else if (part.depth === 3) contents.push(`  - ${link}`)
  // The members of an item, on one line.
  else if (contents.at(-1)!.startsWith('    - ')) contents[contents.length - 1] += `, ${link}`
  else contents.push(`    - ${link}`)
}

const text = [
  '# ubqtest API',
  '',
  'Each export of the `ubqtest` package, with its type and its doc',
  'comment. `npm run docs` makes this file from the type',
  'declarations of the built package. Do not change it by hand. A',
  'test fails if it is not current.',
  '',
  'For how to use the API, with examples and the rules of a test,',
  'read [GUIDE.md](../GUIDE.md) (`ubq guide`).',
  '',
  'The package has three entry points. A test file imports most',
  "names from `'ubqtest'`. `'ubqtest/browser'` is for a test of",
  "front-end code, and `'ubqtest/workers'` is for a test of a",
  'Cloudflare Worker. In each part of this page, the items are in',
  'the order of the alphabet.',
  '',
  '## Contents',
  '',
  ...contents,
  '',
  ...page.flatMap(part => [`${'#'.repeat(part.depth)} ${part.title}`, '', ...part.body]),
].join('\n')

if (!check) writeFileSync(target, text)
else if (readFileSync(target, 'utf8') !== text) {
  process.stderr.write('docs/api.md is not current. Run: npm run docs\n')
  process.exit(1)
}
