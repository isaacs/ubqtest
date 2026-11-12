// Makes `docs/api.md` from the type declarations of the built
// package: each export of `ubqtest`, with its doc comment.
//   node scripts/api-docs.ts            writes the file (needs `npm run build`)
//   node scripts/api-docs.ts --check    exit code 1 if the file is not current
//   node scripts/api-docs.ts --check <folder>   the declarations are in that folder
import { readFileSync, writeFileSync } from 'node:fs'
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
        code: code.join('\n').replace(/^export (declare )?/, '').replace(/^declare /, '').trimEnd(),
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
  for (const part of m[1]!.split(',').map(s => s.trim()).filter(Boolean)) {
    const isType = part.startsWith('type ')
    const item = found.get(part.replace(/^type /, ''))
    if (!item) throw new Error(`no declaration of ${part} in ${m[2]}.d.ts`)
    ;(isType ? typeItems : values).push(item)
  }
}
for (const item of items('index.d.ts').values()) values.push(item)

const section = (item: Item): string =>
  [`### \`${item.name}\``, '', ...(item.comment ? [item.comment, ''] : []), '```ts', item.code, '```', ''].join('\n')

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
  '## Functions',
  '',
  ...values.map(section),
  '## Types',
  '',
  ...typeItems.map(section),
].join('\n')

if (!check) writeFileSync(target, text)
else if (readFileSync(target, 'utf8') !== text) {
  process.stderr.write('docs/api.md is not current. Run: npm run docs\n')
  process.exit(1)
}
