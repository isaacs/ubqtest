// `ubq doctor`: checks the setup of the project, and states the fix
// for each problem.
import { existsSync, globSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// Not a named import: Bun does not have the function that removes types.
import * as nodeModule from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { type Config, config, isBuild } from './config.ts'
import { projectRoot } from './project.ts'
import { select, UsageError } from './runner.ts'
import { vitestWorkers } from './vitest-config.ts'

// The source is `.ts`, and the bundle is `.js`.
const INSTRUMENT = import.meta.url.endsWith('.ts') ? './instrument.ts' : './instrument.js'

/** A name of a test tool that a project removes after the change to ubq. */
export const OLD_TOOL =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bdeclare\s+module\s+|\btypes=)(['"])(vitest|@vitest\/[^'"]+|@cloudflare\/vitest-[^'"]+|cloudflare:test|jest|@jest\/[^'"]+|tap|@tapjs\/[^'"]+|mocha)\1/

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
  else if (+v.node.split('.')[0]! >= 24) ok(`Node ${v.node}`)
  // ubq: not measured: the tests run on Node 24 or later
  else fix(`Node ${v.node} is too old. ubq needs Node 24 or later. Install it, and put it first on the path.`)

  if (existsSync(join(root, 'package.json'))) ok(`project: ${root}`)
  else fix(`no package.json at or above ${root}. The folder of package.json is the project. Run: npm init -y`)

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
        strip(readFileSync(join(root, file), 'utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') hard.push(file)
      }
    }
    process.emitWarning = emitWarning
  }
  if (hard.length)
    fix(
      `${hard.length} files have TypeScript syntax that Node cannot run (enum, namespace, or a parameter property): ${hard.slice(0, 5).join(', ')}${hard.length > 5 ? `, and ${hard.length - 5} more` : ''}. Node runs only syntax that it can erase. Change this syntax, or run the tests on Bun: bun node_modules/ubqtest/cli.js. A project that runs its tests on Bun does not set "erasableSyntaxOnly" in tsconfig.json.`,
    )

  const tsconfig = join(root, 'tsconfig.json')
  if (existsSync(tsconfig)) {
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
          `tsconfig.json: set ${new Intl.ListFormat('en').format(missing.map(key => `"${key}": true`))} in compilerOptions. ${missing.map(key => reasons[key]).join(' ')}`,
        )
      else ok('tsconfig.json')
    }
  }

  out(`doctor: ${problems} problems`)
  return problems
}
