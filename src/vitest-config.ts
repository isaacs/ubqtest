// Reads the vitest config of a project that tests a Cloudflare
// Worker with the vitest plugin, for `ubq convert` and `ubq
// doctor`: the wrangler config, the test files, the test values of
// the bindings, and the setup files of each project in it.
// The config is code. This reads its text, and does not run it.
import { existsSync, readFileSync } from 'node:fs'
import { join, posix, relative, resolve, sep } from 'node:path'
import type { Config } from './config.ts'
import type { Node } from './instrument.ts'

type Parse = (source: string, file: string) => Node
type Children = (node: Node) => Node[]

export interface WorkersProject {
  /** An entry for the `workers` key of the ubq configuration. */
  entry: NonNullable<Config['workers']>[number]
  /** Paths of the setup files, from the project root. */
  setupFiles: string[]
  /** What a person must do by hand. */
  notes: string[]
}

const NAMES = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map(ext => `vitest.config.${ext}`)

class NotPlain extends Error {}

/** The value of a literal in the code. Throws `NotPlain` for other code. */
const plain = (node: Node): unknown => {
  if (node.type === 'Literal') return node.value
  if (node.type === 'TemplateLiteral' && !(node.expressions as Node[]).length)
    return ((node.quasis as Node[])[0]!.value as { cooked: string }).cooked
  if (node.type === 'UnaryExpression' && node.operator === '-') return -(plain(node.argument as Node) as number)
  if (node.type === 'ArrayExpression') return (node.elements as Node[]).map(plain)
  if (node.type === 'ObjectExpression')
    return Object.fromEntries(
      (node.properties as Node[]).map(p => {
        const key = keyOf(p)
        if (key === undefined) throw new NotPlain()
        return [key, plain(p.value as Node)]
      }),
    )
  throw new NotPlain()
}

const keyOf = (property: Node): string | undefined => {
  if (property.type !== 'Property' || property.computed) return undefined
  const key = property.key as Node & { name?: string }
  // ubq: not measured: a key that is not computed is a name or a literal
  return key.type === 'Identifier' ? key.name : key.type === 'Literal' ? String(key.value) : undefined
}

/** The value node of a key of an object in the code. */
const get = (object: Node | undefined, key: string): Node | undefined =>
  object?.type === 'ObjectExpression' ?
    ((object.properties as Node[]).find(p => keyOf(p) === key)?.value as Node | undefined)
  : undefined

/**
 * The Workers projects of the vitest config at the project root.
 * Undefined if there is no such config, or if it has no options of
 * the Workers plugin.
 */
export const vitestWorkers = (root: string, parse: Parse, children: Children): { file: string; projects: WorkersProject[] } | undefined => {
  const file = NAMES.find(name => existsSync(join(root, name)))
  if (!file) return undefined
  let program: Node
  try {
    program = parse(readFileSync(join(root, file), 'utf8'), join(root, file))
  } catch {
    return undefined
  }
  /** A path of the vitest config, as a path from the project root with `/`. */
  const fromRoot = (path: string): string => relative(root, resolve(root, path)).split(sep).join('/')
  const projects: WorkersProject[] = []
  const walk = (node: Node, objects: Node[]): void => {
    if (node.type === 'ObjectExpression') {
      const wrangler = get(node, 'wrangler')
      const miniflare = get(node, 'miniflare')
      // The options of the plugin: `cloudflareTest({ wrangler, miniflare })`,
      // or `poolOptions: { workers: { wrangler, miniflare } }`.
      if (wrangler?.type === 'ObjectExpression' || miniflare?.type === 'ObjectExpression') {
        // The test options of the same project: the nearest object
        // around the plugin options that has `test`, or that is `test`.
        let test: Node | undefined
        for (const outer of [...objects].reverse()) {
          test = get(outer, 'test') ?? (get(outer, 'poolOptions') ? outer : undefined)
          if (test) break
        }
        const notes: string[] = []
        const text = (value: Node | undefined, what: string): string[] => {
          if (!value) return []
          try {
            const found = plain(value)
            return (Array.isArray(found) ? found : [found]).filter((one): one is string => typeof one === 'string')
          } catch {
            notes.push(`${what} in ${file} is not plain text. Give it by hand.`)
            return []
          }
        }
        const config = text(get(wrangler, 'configPath'), 'wrangler.configPath')[0]
        const include = text(get(test, 'include'), 'test.include').map(fromRoot)
        const vars: Record<string, unknown> = {}
        const bindings = get(miniflare, 'bindings')
        for (const property of bindings?.type === 'ObjectExpression' ? (bindings.properties as Node[]) : []) {
          const key = keyOf(property)
          try {
            if (key === undefined) throw new NotPlain()
            vars[key] = plain(property.value as Node)
          } catch {
            // The plugin got the migrations of D1 as a binding. ubq has `migrate`.
            if (!/readD1Migrations|MIGRATIONS/.test(key ?? ''))
              notes.push(`the binding ${key ?? '(a computed key)'} of miniflare.bindings in ${file} is not a plain value. Add it to "vars" by hand.`)
          }
        }
        if (!config) notes.push(`no wrangler.configPath in ${file} for this project. Give the path of the wrangler config in "config".`)
        if (!include.length) notes.push(`no test.include in ${file} for this project. Check the globs in "include".`)
        const folder = config ? posix.dirname(fromRoot(config)) : '.'
        projects.push({
          entry: {
            config: config ? fromRoot(config) : 'wrangler.jsonc',
            include: include.length ? include : [folder === '.' ? '**/*.test.ts' : `${folder}/**/*.test.ts`],
            ...(Object.keys(vars).length && { vars }),
          },
          setupFiles: text(get(test, 'setupFiles'), 'test.setupFiles').map(fromRoot),
          notes,
        })
      }
      objects = [...objects, node]
    }
    for (const child of children(node)) walk(child, objects)
  }
  walk(program, [])
  return projects.length ? { file, projects } : undefined
}

/**
 * The D1 bindings that a vitest setup file applies migrations to
 * (`applyD1Migrations(env.DB, ...)`), and true if the file does no
 * other work.
 */
export const setupMigrations = (source: string): { bindings: string[]; only: boolean } => {
  const call = /(?:await\s+)?applyD1Migrations\(\s*[\w.]*?\.(\w+)\s*,[^)]*\)\s*;?/g
  const bindings = [...source.matchAll(call)].map(m => m[1]!)
  const rest = source
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
    .replace(/^\s*import\b[^;\n]*(?:\n[^;\n]*)*?from\s*['"][^'"]+['"]\s*;?/gm, '')
    .replace(/^\s*import\s*['"][^'"]+['"]\s*;?/gm, '')
    .replace(call, '')
  return { bindings: [...new Set(bindings)], only: bindings.length > 0 && !rest.trim() }
}
