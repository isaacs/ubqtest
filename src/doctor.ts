// `ubq doctor`: checks the setup of the project, and states the fix
// for each problem.
import { existsSync, globSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// Not a named import: Bun does not have the function that removes types.
import * as nodeModule from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { type Config, config, isBuild } from './config.ts'
import { projectRoot } from './project.ts'
import { select, UsageError, workspaces } from './runner.ts'
import { transformer } from './transform.ts'
import { listed, OWN_CONFIG, plainJson, type Tsconfig, tsOptions } from './tsconfig.ts'
import { ownConfig } from './typecheck.ts'
import { vitestWorkers } from './vitest-config.ts'
import { counted } from './counted.ts'

// The source is `.ts`, and the bundle is `.js`.
const INSTRUMENT = import.meta.url.endsWith('.ts') ? './instrument.ts' : './instrument.js'

/** A name of a test tool that a project removes after the change to ubq. */
export const OLD_TOOL =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bdeclare\s+module\s+|\btypes=)(['"])(vitest|@vitest\/[^'"]+|@cloudflare\/vitest-[^'"]+|cloudflare:test|jest|@jest\/[^'"]+|tap|@tapjs\/[^'"]+|tape|ava|mocha|@playwright\/test)\1/

/** An import of a relative path with the extension of a TypeScript file. */
const TS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])\.{1,2}\/[^'"\n]*\.[cm]?tsx?\1/

/** Code that only Bun runs: the global, or a module of Bun. */
const BUN_CODE = /\bBun\.[A-Za-z]|(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])bun(?::[\w/]+)?\1/

/**
 * The choice for a project with source that Node cannot run with
 * only its types removed. The person who owns the project makes it.
 */
export const HARD_CHOICE =
  'Do not choose for the person who owns the project. Ask them to choose one of three. (1) Compile with the typescript package of the project (version 5 or 6): ubq convert --transform=typescript. A file of 10 KB then costs about 4 ms, one time for each change of the file. (2) Compile with swc, which is about 10 times faster: ubq convert --transform=swc, which installs @swc/core as a devDependency. (3) Run the tests on Bun (bun node_modules/ubqtest/cli.js). Coverage on Bun has gaps that coverage on Node does not have, and on Bun a class with decorators does not load if a parameter of its constructor has a type that the file imports with no "import type". With each of the three, tsconfig.json does not set "erasableSyntaxOnly".'

/**
 * False if the tsconfig file names its files, and the test file is
 * not one of them. True if this check cannot know: a config that
 * does not parse, one with `references`, or one that gets its list
 * from a base config.
 */
const tsIncludes = (config: string, file: string): boolean => {
  let json: Tsconfig
  try {
    json = JSON.parse(plainJson(readFileSync(config, 'utf8')))
  } catch {
    return true
  }
  // A config with only references to other configs, as Nx makes:
  // `tsc -p` of this file checks no file.
  if (Array.isArray(json.files) && !json.files.length && !json.include?.length) return false
  if (json.references || (json.extends && !json.include && !json.files)) return true
  return listed(json, dirname(config), file)
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
      counted`note this folder is the root of a monorepo with ${projects.length} project|projects (${projects.slice(0, 3).join(', ')}${projects.length > 3 ? ', ...' : ''}). ubq runs the tests of one project: run ubq and ubq doctor in the folder of a project. At the root, ubq runs each project, one after the other, only if the root has no test files of its own.`,
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
    if (tests.length) ok(counted`${tests.length} test file|files`)
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
      counted`${other.length} test file|files does|do not import ubqtest: ${other.slice(0, 5).join(', ')}${other.length > 5 ? `, and ${other.length - 5} more` : ''}. Convert each test file: ubq convert <file>. Remove each file that is not a test file, or add it to "ubq": { "exclude": [...] } in package.json.`,
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
  let transform: Config['transform']
  let dom: Config['dom']
  try {
    workers = config().workers
    dom = config().dom
    // Bun and Deno compile TypeScript themselves.
    if (!v.bun && !v.deno) transform = config().transform
  } catch {
    // The check of the test files above reports this.
  }
  if (dom) {
    let found = true
    try {
      createRequire(join(root, 'package.json')).resolve(dom.package)
    } catch {
      found = false
    }
    if (v.deno)
      // ubq: not measured: no test runs doctor on Deno with the dom key
      fix(
        '"ubq.dom" is set, and jsdom and happy-dom do not load in a test process of Deno. Run the test files that need a DOM on Node or on Bun.',
      )
    else if (found) ok(`${dom.package}, for test files with a DOM`)
    else
      fix(
        `"ubq.dom" names the package ${dom.package}, and the project does not have it. Run: npm install --save-dev ${dom.package}`,
      )
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
      counted`${stray.length} file|files has|have tests, and "ubq" with no arguments does not run them: ${stray.slice(0, 5).join(', ')}${more}. Give each one a name that ends in .test.ts, or add them to "ubq": { "include": [...] } in package.json.`,
    )
  }

  // Test files of a different tool that `ubq` does not run: a tap
  // file has no `.test.` in its name.
  const old = code
    .filter(file => !tests.includes(file) && !isBuild(file) && OLD_TOOL.test(readFileSync(join(root, file), 'utf8')))
    .sort()
  if (old.length) {
    const folders = [...new Set(old.map(file => (file.includes('/') ? file.slice(0, file.indexOf('/')) : file)))]
    fix(
      counted`${old.length} file|files imports|import a different test tool, and "ubq" does not run it|them: ${old.slice(0, 5).join(', ')}${old.length > 5 ? `, and ${old.length - 5} more` : ''}. Read "ubq guide convert", then: ubq convert ${folders.join(' ')}`,
    )
  }

  if (transform)
    try {
      transformer(root, transform)
      ok(`transform: ${transform}`)
    } catch (error) {
      fix((error as Error).message)
    }
  // Node removes the types of a file and makes no other change.
  // Bun has no function that does only that, and runs each syntax.
  // With the `transform` key, a compiler makes the JavaScript.
  const strip = transform ? undefined : nodeModule.stripTypeScriptTypes
  const hard: string[] = []
  // Node has no loader for a file with JSX. A project can have
  // such files for a web site, with no test of them.
  const jsx: string[] = []
  if (strip) {
    // Node prints a warning the first time that a program removes types.
    const emitWarning = process.emitWarning
    process.emitWarning = () => {}
    for (const file of code) {
      if (!/(?<!\.d)\.[cm]?ts$|\.[jt]sx$/.test(file)) continue
      try {
        if (isBuild(file)) continue
        if (file.endsWith('sx')) {
          jsx.push(file)
          continue
        }
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
  if (hard.length || jsx.length)
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
  hard.push(...jsx.filter(file => loaded.has(file)).sort())
  const reached = hard.filter(file => loaded.has(file))
  const some = (files: string[]): string =>
    `${files.slice(0, 5).join(', ')}${files.length > 5 ? `, and ${files.length - 5} more` : ''}`
  const which =
    reached.length && reached.length < hard.length
      ? ` The tests import ${reached.length} of them: ${some(reached)}. No test imports the others now.`
      : ''
  // Code for Bun does not run on a different runtime. Not a file
  // that tests for the global: it has code for other runtimes too.
  const forBun = v.bun
    ? []
    : code.filter(file => {
        try {
          const source = readFileSync(join(root, file), 'utf8')
          return BUN_CODE.test(source) && !/\btypeof Bun\b/.test(source)
          // ubq: not measured: the list has only files that exist
        } catch {
          return false
        }
      })
  if (forBun.length)
    fix(
      counted`${forBun.length} file|files uses|use the Bun global or a bun: module: ${some(forBun)}. This code runs only on Bun, so run ubq on Bun too: bun node_modules/ubqtest/cli.js doctor, and "test": "bun node_modules/ubqtest/cli.js" in the scripts of package.json. ubq needs Bun 1.4 or later.`,
    )
  // On Bun, each syntax runs.
  else if (hard.length)
    fix(
      counted`${hard.length} file|files has|have syntax that Node cannot run (enum, namespace, a parameter property, a decorator, or the JSX of a .tsx or .jsx file): ${some(hard)}.${which} Node runs only TypeScript syntax that it can erase. ${HARD_CHOICE}`,
    )

  /** The first file of the project that imports a relative path with a `.ts` extension. */
  let withTs: string | undefined | null = null
  const tsImport = (): string | undefined =>
    (withTs ??= code.find(file => {
      try {
        return TS_IMPORT.test(readFileSync(join(root, file), 'utf8'))
        // ubq: not measured: the list has only files that exist
      } catch {
        return false
      }
    }))
  // The type check reads the tsconfig.json of each folder from a
  // test file up to the root. The options must be in a config
  // that has the test files.
  const configs = new Set<string>()
  const bare: string[] = []
  for (const file of tests.filter(file => /\.[cm]?tsx?$/.test(file))) {
    let found: string | undefined
    for (let dir = dirname(join(root, file)); !found; dir = dirname(dir)) {
      const config = join(dir, 'tsconfig.json')
      const own = join(dir, OWN_CONFIG)
      // The type check reads the config of ubq, or makes it from a
      // config that the tsconfig.json of the folder references.
      if (existsSync(own)) found = tsIncludes(own, join(root, file)) ? own : undefined
      else if (existsSync(config))
        found = tsIncludes(config, join(root, file)) ? config : ownConfig(dir, [join(root, file)])?.base
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
      ? { extends: `../${base}` }
      : {
          extends: '../tsconfig.json',
          compilerOptions: {
            noEmit: true,
            ...(tsImport() && { allowImportingTsExtensions: true }),
            ...(!v.bun && !hard.length && !transform && { erasableSyntaxOnly: true }),
          },
          include: ['.'],
        }
    fix(
      counted`${bare.length} test file|files is|are in no tsconfig.json: ${bare.slice(0, 5).join(', ')}${bare.length > 5 ? `, and ${bare.length - 5} more` : ''}. ${solution ? 'tsconfig.json has only "references" to other configs, and no config of its folder that it references has these files. ' : ''}The type check of ubq reads the tsconfig.json of each folder from a test file up to the project root (tsconfig.ubq.json, if the folder has one), and no other file name. ${folder ? `Add ${folder}/tsconfig.json: ${JSON.stringify(made)}. Do not add the test files to the tsconfig.json of the source.` : 'Add them to "include" of tsconfig.json.'}`,
    )
  }
  // With no TypeScript test file, the config of the project.
  if (!configs.size && !bare.length && existsSync(main)) configs.add(main)
  let fieldNote = false
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
        allowImportingTsExtensions: `${tsImport()} imports a file with the .ts extension.`,
        erasableSyntaxOnly:
          'The runtime runs only TypeScript syntax that it can erase (no enum, no namespace, no parameter properties).',
        rewriteRelativeImportExtensions: `${tsImport()} imports a file with the .ts extension. This tsconfig makes JavaScript files: tsc then changes the .ts extension of an import to .js. It needs TypeScript 5.7 or later.`,
      }
      const emits = options.noEmit !== true && options.emitDeclarationOnly !== true
      const missing = (
        [
          // Only for a project with such an import: an import with
          // no extension needs no option (D78). tsc refuses it with
          // emit, and rewriteRelativeImportExtensions also permits
          // such an import.
          ...(tsImport() && !emits && options.rewriteRelativeImportExtensions !== true
            ? (['allowImportingTsExtensions'] as const)
            : []),
          // Not for a project that must run on Bun.
          ...(v.bun || hard.length || transform ? [] : (['erasableSyntaxOnly'] as const)),
          ...(emits && tsImport() ? (['rewriteRelativeImportExtensions'] as const) : []),
        ] as const
      ).filter(key => options[key] !== true)
      // The check above found no file with such syntax: the option
      // only keeps new such syntax out (D130).
      const needed = missing.filter(key => key !== 'erasableSyntaxOnly')
      if (needed.length)
        fix(
          `${name}: set ${new Intl.ListFormat('en').format(needed.map(key => `"${key}": true`))} in compilerOptions. ${needed.map(key => reasons[key]).join(' ')}`,
        )
      else ok(name)
      if (missing.includes('erasableSyntaxOnly'))
        out(
          `note ${name}: "erasableSyntaxOnly": true in compilerOptions makes the type check report new syntax that Node cannot run. ${reasons.erasableSyntaxOnly}`,
        )
      // TypeScript defines a class field with no value only for a
      // target of ES2022 or later, unless the option says so. Node
      // keeps each field declaration.
      const target = typeof options.target === 'string' ? options.target.toLowerCase() : undefined
      const old = target !== undefined && /^es(3|5|6|20(1\d|2[01]))$/.test(target)
      const defines = options.useDefineForClassFields ?? (target === undefined ? undefined : !old)
      if (defines === false && !transform && !v.bun && !fieldNote) {
        fieldNote = true
        out(
          `note ${name} has ${options.useDefineForClassFields === false ? '"useDefineForClassFields": false' : `"target": "${String(options.target)}"`}. Code that tsc makes with it has a class field with no value only after code assigns the field. Node keeps the declaration of the field, so in a test the field is there after "new", with the value undefined. A test that reads the keys of such an object ('x' in object, Object.keys), or a class that has a field with the name of a field of its base class, gets a different result from the built code. Few tests see this. If one does: the "transform" key compiles with the options of the tsconfig (ubq convert --transform=typescript).`,
        )
      }
    }
  }

  // The imports of an ES module run before its first line. A value
  // of the environment that a line above an import sets is not
  // there while the imported module loads.
  const early = tests.filter(file => {
    if (/\.c[jt]sx?$/.test(file)) return false
    let lines: string[] = []
    try {
      lines = readFileSync(join(root, file), 'utf8').split('\n')
      // ubq: not measured: the list has only files that exist
    } catch {
      return false
    }
    const last = lines.findLastIndex(line => /^import\s+(?!type\b|\()/.test(line))
    return lines.slice(0, last).some(line => /^process\.env\b[^=]*=[^=]/.test(line))
  })
  if (early.length)
    out(
      counted`note ${early.length} test file|files sets|set a value of process.env above an import: ${some(early)}. The imports of an ES module run before the first line of the file. If a module reads this value while it loads, load that module after the line: await import(path).`,
    )

  out(counted`doctor: ${problems} problem|problems`)
  return problems
}
