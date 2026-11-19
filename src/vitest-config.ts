// Reads the vitest config of a project that tests a Cloudflare
// Worker with the vitest plugin, for `ubq convert` and `ubq
// doctor`: the wrangler config, the test files, the test values of
// the bindings, and the setup files of each project in it. Also
// reads the `define` values of a vite or vitest config.
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
  object?.type === 'ObjectExpression'
    ? ((object.properties as Node[]).find(p => keyOf(p) === key)?.value as Node | undefined)
    : undefined

/**
 * The Workers projects of the vitest config at the project root.
 * Undefined if there is no such config, or if it has no options of
 * the Workers plugin.
 */
export const vitestWorkers = (
  root: string,
  parse: Parse,
  children: Children,
): { file: string; projects: WorkersProject[] } | undefined => {
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
              notes.push(
                `the binding ${key ?? '(a computed key)'} of miniflare.bindings in ${file} is not a plain value. Add it to "vars" by hand.`,
              )
          }
        }
        // The other options of miniflare: ubq uses the wrangler config.
        for (const property of miniflare?.type === 'ObjectExpression' ? (miniflare.properties as Node[]) : []) {
          const key = keyOf(property)
          if (key === 'bindings') continue
          notes.push(
            `${key === undefined ? 'a computed key of miniflare' : `miniflare.${key}`} in ${file} is not in the ubq configuration. ubq uses the wrangler config.` +
              (key === 'serviceBindings'
                ? ' A service binding to a Worker that is not this one answers fetch with 503. To test code that uses the service, give the handler an env object with your own value for that binding.'
                : ''),
          )
        }
        if (!config)
          notes.push(
            `no wrangler.configPath in ${file} for this project. Give the path of the wrangler config in "config".`,
          )
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
 * The `define` values of the vitest and vite configs at the project
 * root, as JSON values for the `define` key of the ubq
 * configuration (D83). Undefined if no config has `define`, and no
 * config spreads a config from a different file.
 */
export const viteDefine = (
  root: string,
  parse: Parse,
  children: Children,
): { define: Record<string, unknown>; env: Record<string, string>; notes: string[] } | undefined => {
  const define: Record<string, unknown> = {}
  const env: Record<string, string> = {}
  const notes: string[] = []
  let found = false
  for (const file of [...NAMES, ...NAMES.map(name => name.replace('vitest', 'vite'))]) {
    if (!existsSync(join(root, file))) continue
    let program: Node
    try {
      program = parse(readFileSync(join(root, file), 'utf8'), join(root, file))
    } catch {
      continue
    }
    let spread = false
    let plugins = false
    let limit: unknown
    /** The names of `test.env` with a value that is not plain text, and of the aliases for imports. */
    const hard: string[] = []
    const alias: string[] = []
    const names = (object: Node | undefined): string[] =>
      object?.type === 'ObjectExpression'
        ? (object.properties as Node[]).map(p => keyOf(p) ?? 'a computed key')
        : object
          ? ['not a plain object']
          : []
    const walk = (node: Node): void => {
      if (node.type === 'SpreadElement' && (node.argument as Node).type === 'Identifier') spread = true
      const list = node.type === 'ObjectExpression' ? get(node, 'plugins') : undefined
      // ubq does the work of the Workers plugin.
      const known = (e: Node | null): boolean =>
        e?.type === 'CallExpression' && (e.callee as Node & { name?: string }).name === 'cloudflareTest'
      if (list && !(list.type === 'ArrayExpression' && (list.elements as (Node | null)[]).every(known))) plugins = true
      const given = get(get(node, 'test'), 'env')
      if (given?.type === 'ObjectExpression')
        for (const property of given.properties as Node[]) {
          const key = keyOf(property)
          const value = property.value as Node | undefined
          if (key !== undefined && value?.type === 'Literal' && value.value !== null && typeof value.value !== 'object')
            env[key] = String(value.value)
          else hard.push(key ?? 'a computed key')
        }
      else if (given) hard.push('not a plain object')
      alias.push(...names(get(get(node, 'test'), 'alias')), ...names(get(get(node, 'resolve'), 'alias')))
      const timeout = node.type === 'ObjectExpression' ? get(node, 'testTimeout') : undefined
      if (timeout?.type === 'Literal' && typeof timeout.value === 'number') limit = timeout.value
      const values = node.type === 'ObjectExpression' ? get(node, 'define') : undefined
      if (values?.type === 'ObjectExpression') {
        found = true
        for (const property of values.properties as Node[]) {
          const key = keyOf(property)
          if (key === undefined || !/^[A-Za-z_$][\w$]*$/.test(key)) {
            notes.push(
              `${key ?? 'a computed key'} of define in ${file} is not a global name. ubq sets only global names. Set it in the test by hand.`,
            )
            continue
          }
          const value = property.value as Node
          try {
            // Vite reads a string as code: 'true', '"text"'.
            // `JSON.stringify(value)` gives the same code.
            const callee = value.callee as Node | undefined
            const stringify =
              value.type === 'CallExpression' &&
              callee?.type === 'MemberExpression' &&
              (callee.object as Node & { name?: string }).name === 'JSON' &&
              (callee.property as Node & { name?: string }).name === 'stringify'
            const plainValue = stringify ? plain((value.arguments as Node[])[0]!) : plain(value)
            define[key] = typeof plainValue === 'string' && !stringify ? JSON.parse(plainValue) : plainValue
          } catch {
            notes.push(`the value of ${key} in the define of ${file} is not a plain value. Add it to "define" by hand.`)
          }
        }
      }
      for (const child of children(node)) walk(child)
    }
    walk(program)
    if (plugins)
      notes.push(
        `${file} has plugins. ubq has no plugins: it runs the source files as they are. If a plugin changes the code that the tests run, tell the user.`,
      )
    if (limit !== undefined)
      notes.push(
        `${file} has testTimeout: ${limit}. The time limit of a test in ubq is 5000 ms. To keep the limit of the old config, add to "ubq" in package.json: "timeout": ${limit}`,
      )
    if (hard.length)
      notes.push(
        `${file} has values in test.env that are not plain text (${hard.join(', ')}). Add them to "env" in "ubq" in package.json by hand.`,
      )
    if (alias.length)
      notes.push(
        `${file} has an alias for imports (${alias.join(', ')}). ubq does not change the name of an import. Use a name that the runtime finds: a relative path, the "imports" key of package.json, or a package of the workspace.`,
      )
    if (spread && !found)
      notes.push(
        `${file} spreads a config from a different file. If that config has define, add its values to "ubq.define" in package.json, such as { "__DEBUG_BUILD__": true }.`,
      )
  }
  return found || notes.length || Object.keys(env).length ? { define, env, notes } : undefined
}

/**
 * What a project with tests of Playwright Test must set by hand:
 * notes from the `playwright.config` file at the project root.
 * ubq does not read that file.
 */
export const playwrightNotes = (root: string, parse: Parse, children: Children): string[] => {
  const notes: string[] = []
  for (const file of NAMES.map(name => name.replace('vitest', 'playwright'))) {
    if (!existsSync(join(root, file))) continue
    const source = readFileSync(join(root, file), 'utf8')
    let program: Node
    try {
      program = parse(source, join(root, file))
    } catch {
      continue
    }
    const browser: { url?: string; command?: string } = {}
    const text = (node: Node | undefined): string | undefined => {
      try {
        const value = node && plain(node)
        return typeof value === 'string' ? value : undefined
      } catch {
        return undefined
      }
    }
    /** The address of the server, if the config has no base URL. */
    let server: string | undefined
    const walk = (node: Node): void => {
      browser.url ??= text(get(node, 'baseURL'))
      server ??= text(get(get(node, 'webServer'), 'url'))
      browser.command ??= text(get(get(node, 'webServer'), 'command'))
      for (const child of children(node)) walk(child)
    }
    walk(program)
    browser.url ??= server
    notes.push(
      browser.url
        ? `ubq does not read ${file}. For the address of the pages and the server of the tests, add to "ubq" in package.json: "browser": ${JSON.stringify(browser)}`
        : `ubq does not read ${file}. If the tests load pages from a server, add its address to "ubq" in package.json: "browser": { "url": "http://localhost:3000", "command": "npm run dev" }`,
    )
    if (/firefox|webkit|safari/i.test(source))
      notes.push(`${file} names a browser that is not Chromium. ubq runs the tests in Chromium only. Tell the user.`)
  }
  return notes
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
