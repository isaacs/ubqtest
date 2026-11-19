// `ubq doctor`: checks the setup of the project, and states the fix
// for each problem.
import { existsSync, globSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// Not a named import: Bun does not have the function that removes types.
import * as nodeModule from 'node:module'
import { dirname, isAbsolute, join, matchesGlob, relative, resolve } from 'node:path'
import { type Config, config, isBuild } from './config.ts'
import { projectRoot } from './project.ts'
import { select, UsageError, workspaces } from './runner.ts'
import { vitestWorkers } from './vitest-config.ts'

// The source is `.ts`, and the bundle is `.js`.
const INSTRUMENT = import.meta.url.endsWith('.ts') ? './instrument.ts' : './instrument.js'

/** A name of a test tool that a project removes after the change to ubq. */
export const OLD_TOOL =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bdeclare\s+module\s+|\btypes=)(['"])(vitest|@vitest\/[^'"]+|@cloudflare\/vitest-[^'"]+|cloudflare:test|jest|@jest\/[^'"]+|tap|@tapjs\/[^'"]+|tape|ava|mocha|@playwright\/test)\1/

/** `// ...` and `/* ... *\/` comments, and commas before `}` or `]`. */
const plainJson = (text: string): string =>
  text
    .replace(/("(?:\\.|[^"\\])*")|\/\/.*|\/\*[\s\S]*?\*\//g, (_, string) => string ?? '')
    .replace(/,(\s*[}\]])/g, '$1')

/**
 * The compilerOptions of a tsconfig file, with the options of each
 * config that it extends. Throws if a file cannot be read.
 */
const tsOptions = (file: string): Record<string, unknown> => {
  const json = JSON.parse(plainJson(readFileSync(file, 'utf8')))
  const options: Record<string, unknown> = {}
  for (const base of [json.extends ?? []].flat() as string[])
    Object.assign(options, tsOptions(tsBase(base, dirname(file))))
  return Object.assign(options, json.compilerOptions)
}

/** The file of a base config: a path, or a config in a package. */
const tsBase = (base: string, dir: string): string => {
  if (base.startsWith('.') || isAbsolute(base)) {
    const path = resolve(dir, base)
    return existsSync(path) || path.endsWith('.json') ? path : `${path}.json`
  }
  const require = createRequire(join(dir, 'tsconfig.json'))
  if (base.endsWith('.json')) return require.resolve(base)
  try {
    return require.resolve(`${base}/tsconfig.json`)
  } catch {
    return require.resolve(`${base}.json`)
  }
}

/**
 * False if the tsconfig file names its files, and the test file is
 * not one of them. True if this check cannot know: a config that
 * does not parse, one with `references`, or one that gets its list
 * from a base config.
 */
const tsIncludes = (config: string, file: string): boolean => {
  let json: { include?: string[]; files?: string[]; exclude?: string[]; extends?: unknown; references?: unknown }
  try {
    json = JSON.parse(plainJson(readFileSync(config, 'utf8')))
  } catch {
    return true
  }
  // A config with only references to other configs, as Nx makes:
  // `tsc -p` of this file checks no file.
  if (Array.isArray(json.files) && !json.files.length && !json.include?.length) return false
  if (json.references || (json.extends && !json.include && !json.files)) return true
  const path = relative(dirname(config), file).split('\\').join('/')
  // A name with no pattern is a file or a folder.
  const match = (globs: string[]): boolean =>
    globs.some(glob => {
      const name = glob.replace(/^\.\//, '').replace(/\/$/, '')
      return name === '.' || name === '' || matchesGlob(path, name) || matchesGlob(path, `${name}/**`)
    })
  if (json.exclude && match(json.exclude)) return false
  if (json.files?.some(name => name.replace(/^\.\//, '') === path)) return true
  return json.include ? match(json.include) : !json.files
}

/** Prints one line for each check. Returns the count of problems. */
export const doctor = (out: (text: string) => void): number => {
  let problems = 0
  const ok = (text: string): void => out(`ok   ${text}`)
  const fix = (text: string): void => {
    problems++
    out(`FIX  ${text}`)
  }
  const root = projectRoot()

  const v = process.versions
  if (v.deno) ok(`Deno ${v.deno}`)
  else if (v.bun) ok(`Bun ${v.bun}`)
  // The two functions of Node that ubq needs, not a version number:
  // load hooks in the thread of the program, and TypeScript files
  // with no flag. Node 22.18 is the first version with the two.
  else if (typeof nodeModule.registerHooks === 'function' && process.features.typescript) ok(`Node ${v.node}`)
  // ubq: not measured: the tests run on a Node that has the two
  else fix(`Node ${v.node} is too old. ubq needs Node 22.18 or later. Install it, and put it first on the path.`)

  if (existsSync(join(root, 'package.json'))) ok(`project: ${root}`)
  else fix(`no package.json at or above ${root}. The folder of package.json is the project. Run: npm init -y`)
  // The root of a monorepo: each folder with a package.json is its
  // own project.
  const projects = workspaces()
  if (projects.length)
    out(
      `note this folder is the root of a monorepo with ${projects.length} projects (${projects.slice(0, 3).join(', ')}${projects.length > 3 ? ', ...' : ''}). ubq runs the tests of one project: run ubq and ubq doctor in the folder of a project. At the root, ubq runs each project, one after the other, only if the root has no test files of its own.`,
    )

  try {
    createRequire(join(root, 'package.json')).resolve('ubqtest')
    ok("import from 'ubqtest' works in this project")
  } catch {
    fix("the project cannot import 'ubqtest'. Run: npm install --save-dev ubqtest")
  }

  let tests: string[] = []
  try {
    tests = select([]).map(s => s.file)
    if (tests.length) ok(`${tests.length} test files`)
    else
      fix(
        'no test files. The name of a test file must end in .test.ts (or .test.js, .test.mts, ...). Rename the files, or set "ubq": { "include": ["test/**/*.ts"] } in package.json.',
      )
  } catch (error) {
    // ubq: not measured: select() throws only usage errors
    if (!(error instanceof UsageError)) throw error
    fix(error.message)
  }

  const sources = tests.map(file => readFileSync(join(root, file), 'utf8'))
  // A file with no import can have no tests, such as a snapshot file
  // of tap. A file can also get ubqtest through a helper.
  const other = tests.filter(
    (_, i) =>
      !sources[i]!.includes('ubqtest') && (OLD_TOOL.test(sources[i]!) || !/\b(import|require)\b/.test(sources[i]!)),
  )
  if (other.length)
    fix(
      `${other.length} test files do not import ubqtest: ${other.slice(0, 5).join(', ')}${other.length > 5 ? `, and ${other.length - 5} more` : ''}. Convert each test file: ubq convert <file>. Remove each file that is not a test file, or add it to "ubq": { "exclude": [...] } in package.json.`,
    )

  let workersPool = false
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    workersPool = '@cloudflare/vitest-pool-workers' in all || '@cloudflare/vitest-plugin' in all
  } catch {
    // The check of package.json above reports this.
  }
  /** Folders that are not part of the project: packages, hidden folders, and other projects. */
  const skip = (path: string): boolean =>
    /(^|[\\/])(node_modules$|\.)/.test(path) || existsSync(join(root, path, 'package.json'))

  let workers: Config['workers']
  try {
    workers = config().workers
  } catch {
    // The check of the test files above reports this.
  }
  if (workers) {
    const absent = workers.map(entry => entry.config).filter(path => !existsSync(join(root, path)))
    let wrangler = true
    try {
      createRequire(join(root, 'package.json')).resolve('wrangler')
    } catch {
      wrangler = false
    }
    if (absent.length)
      fix(`"ubq.workers" in package.json names a wrangler config that does not exist: ${absent.join(', ')}`)
    else if (!wrangler)
      fix(
        '"ubq.workers" is set, and the project does not have wrangler. Tests in the Workers runtime need it. Run: npm install --save-dev wrangler',
      )
    else ok('wrangler, for tests in the Workers runtime')
  } else if (workersPool || sources.some(source => /from\s+['"](cloudflare:|ubqtest\/workers)/.test(source))) {
    // One entry for each Worker: from the vitest config of the
    // project, or from the wrangler configs that the project has.
    const { parse, children } = createRequire(import.meta.url)(INSTRUMENT) as typeof import('./instrument.ts')
    const vitest = vitestWorkers(root, parse, children)
    const configs = globSync('**/wrangler.{jsonc,json,toml}', { cwd: root, exclude: skip })
      .map(file => file.split('\\').join('/'))
      // The first entry that has a file wins: a folder goes before the root.
      // ubq: not measured: no test has two configs at one depth
      .sort((a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b))
    const entries =
      vitest?.projects.map(project => project.entry) ??
      (configs.length ? configs : ['wrangler.jsonc']).map(config => ({
        config,
        include: [config.includes('/') ? `${config.slice(0, config.lastIndexOf('/'))}/**/*.test.ts` : '**/*.test.ts'],
      }))
    const about =
      'this project has tests of a Cloudflare Worker (a test file imports from \'cloudflare:\', or the project has the vitest plugin for Workers). They must run in the Workers runtime, which needs the "workers" key of the ubq configuration.'
    // `ubq convert` writes the key. A person who adds it by hand
    // first does the work two times. It is not a problem now.
    if (vitest)
      out(`note ${about} Do not add it by hand: "ubq convert" writes it to package.json, from ${vitest.file}.`)
    else
      fix(
        `${about} Add to "ubq" in package.json, and check the path of each wrangler config and the globs of its test files:\n${JSON.stringify({ workers: entries }, null, 2)}`,
      )
  }

  if (sources.some(source => source.includes('ubqtest/browser'))) {
    try {
      createRequire(join(root, 'package.json')).resolve('playwright-core')
      ok(
        "playwright-core, for 'ubqtest/browser'. If a test says that the browser is not installed: npx ubq browser install",
      )
    } catch {
      fix(
        "a test file imports 'ubqtest/browser', and the project does not have playwright-core. Run: npm install --save-dev playwright-core, then: npx ubq browser install",
      )
    }
  }

  const code = globSync('**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}', { cwd: root, exclude: skip }).map(file =>
    file.split('\\').join('/'),
  )
  // Files that look like test files, and that `ubq` does not run.
  const stray = code
    .filter(file => {
      if (tests.includes(file)) return false
      const source = readFileSync(join(root, file), 'utf8')
      return /^import .* from ['"]ubqtest['"]/m.test(source) && /^\s*test\(/m.test(source)
    })
    .sort()
  if (stray.length) {
    const more = stray.length > 5 ? `, and ${stray.length - 5} more` : ''
    fix(
      `${stray.length} files have tests, and "ubq" with no arguments does not run them: ${stray.slice(0, 5).join(', ')}${more}. Give each one a name that ends in .test.ts, or add them to "ubq": { "include": [...] } in package.json.`,
    )
  }

  // Node removes the types of a file and makes no other change.
  // Bun has no function that does only that, and runs each syntax.
  const strip = nodeModule.stripTypeScriptTypes
  const hard: string[] = []
  if (strip) {
    // Node prints a warning the first time that a program removes types.
    const emitWarning = process.emitWarning
    process.emitWarning = () => {}
    for (const file of code) {
      if (!/(?<!\.d)\.[cm]?ts$/.test(file)) continue
      try {
        if (isBuild(file)) continue
        const source = readFileSync(join(root, file), 'utf8')
        strip(source)
        // A decorator is JavaScript syntax that Node does not have
        // yet: a line that starts with `@Name`. A line of a doc
        // comment starts with `*`.
        if (/^[ \t]*@[A-Za-z_$][\w$.]*[ \t]*(\(|$)/m.test(source)) hard.push(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') hard.push(file)
      }
    }
    process.emitWarning = emitWarning
  }
  // The files that the tests import, by the text of each import
  // with a relative path. A question about a file that no test
  // loads is not necessary.
  const loaded = new Set(tests)
  if (hard.length)
    for (const file of loaded) {
      let text = ''
      try {
        text = readFileSync(join(root, file), 'utf8')
      } catch {
        // ubq: not measured: the list has only files that exist
      }
      for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])(\.{1,2}\/[^'"]*)\1/g)) {
        const path = relative(root, resolve(root, dirname(file), m[2]!))
          .split('\\')
          .join('/')
        const base = path.replace(/\.[cm]?js$/, '')
        const found = [
          path,
          ...['.ts', '.tsx', '.mts', '.cts', '/index.ts'].flatMap(end => [base + end, path + end]),
        ].find(name => code.includes(name))
        if (found) loaded.add(found)
      }
    }
  const reached = hard.filter(file => loaded.has(file))
  const some = (files: string[]): string =>
    `${files.slice(0, 5).join(', ')}${files.length > 5 ? `, and ${files.length - 5} more` : ''}`
  const which =
    reached.length && reached.length < hard.length
      ? ` The tests import ${reached.length} of them: ${some(reached)}. No test imports the others now.`
      : ''
  if (hard.length)
    fix(
      `${hard.length} files have TypeScript syntax that Node cannot run (enum, namespace, a parameter property, or a decorator): ${some(hard)}.${which} Node runs only syntax that it can erase. Do not choose for the person who owns the project. Ask them: change this syntax, run the tests on Bun (bun node_modules/ubqtest/cli.js), or test a build of the source. With Bun or a build, tsconfig.json does not set "erasableSyntaxOnly".`,
    )

  // The type check reads the tsconfig.json of each folder from a
  // test file up to the root. The options must be in a config
  // that has the test files.
  const configs = new Set<string>()
  const bare: string[] = []
  for (const file of tests.filter(file => /\.[cm]?tsx?$/.test(file))) {
    let found: string | undefined
    for (let dir = dirname(join(root, file)); !found; dir = dirname(dir)) {
      const config = join(dir, 'tsconfig.json')
      if (existsSync(config) && tsIncludes(config, join(root, file))) found = config
      if (dir === root) break
    }
    if (found) configs.add(found)
    else bare.push(file)
  }
  const main = join(root, 'tsconfig.json')
  if (bare.length && existsSync(main)) {
    const folder = bare[0]!.includes('/') ? bare[0]!.slice(0, bare[0]!.indexOf('/')) : undefined
    let solution = false
    try {
      const json = JSON.parse(plainJson(readFileSync(main, 'utf8'))) as { files?: unknown[]; references?: unknown }
      solution = !!json.references && Array.isArray(json.files) && !json.files.length
    } catch {
      // Not JSON: the type checker reports it.
    }
    // The config of the tests: `tsconfig.spec.json` is its name in
    // a project of Nx.
    const base = ['tsconfig.test.json', 'tsconfig.spec.json'].find(
      name => existsSync(join(root, name)) && tsIncludes(join(root, name), join(root, bare[0]!)),
    )
    const made = base
      ? // A config with `composite` reports each file that its list
        // does not have (TS6307).
        { extends: `../${base}`, ...(solution && { compilerOptions: { composite: false } }) }
      : {
          extends: '../tsconfig.json',
          compilerOptions: {
            noEmit: true,
            allowImportingTsExtensions: true,
            ...(!v.bun && !hard.length && { erasableSyntaxOnly: true }),
          },
          include: ['.'],
        }
    fix(
      `${bare.length} test files are in no tsconfig.json: ${bare.slice(0, 5).join(', ')}${bare.length > 5 ? `, and ${bare.length - 5} more` : ''}. ${solution ? 'tsconfig.json has only "references" to other configs, and ubq runs "tsc -p tsconfig.json", which does not build references: the type check reads no file. If the check then reports TS6059 for a file of a different project, set "rootDir" in the new config to the root of the monorepo. ' : ''}The type check of ubq reads the tsconfig.json of each folder from a test file up to the project root, and no other file name. ${folder ? `Add ${folder}/tsconfig.json: ${JSON.stringify(made)}. Do not add the test files to the tsconfig.json of the source.` : 'Add them to "include" of tsconfig.json.'}`,
    )
  }
  // With no TypeScript test file, the config of the project.
  if (!configs.size && !bare.length && existsSync(main)) configs.add(main)
  for (const tsconfig of configs) {
    const name = relative(root, tsconfig).split('\\').join('/')
    let options: Record<string, unknown> | undefined
    try {
      options = tsOptions(tsconfig)
    } catch {
      // Not a form that this check can read, or a base that is not there.
    }
    if (options) {
      const reasons = {
        allowImportingTsExtensions: 'The guides import files with the .ts extension.',
        erasableSyntaxOnly:
          'The runtime runs only TypeScript syntax that it can erase (no enum, no namespace, no parameter properties).',
        rewriteRelativeImportExtensions:
          'This tsconfig makes JavaScript files: tsc then changes the .ts extension of an import to .js. It needs TypeScript 5.7 or later.',
      }
      const emits = options.noEmit !== true && options.emitDeclarationOnly !== true
      const missing = (
        [
          'allowImportingTsExtensions',
          // Not for a project that must run on Bun.
          ...(v.bun || hard.length ? [] : (['erasableSyntaxOnly'] as const)),
          ...(emits ? (['rewriteRelativeImportExtensions'] as const) : []),
        ] as const
      ).filter(key => options[key] !== true)
      if (missing.length)
        fix(
          `${name}: set ${new Intl.ListFormat('en').format(missing.map(key => `"${key}": true`))} in compilerOptions. ${missing.map(key => reasons[key]).join(' ')}`,
        )
      else ok(name)
    }
  }

  out(`doctor: ${problems} problems`)
  return problems
}
