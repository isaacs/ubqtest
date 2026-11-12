// `ubq doctor`: checks the setup of the project, and states the fix
// for each problem.
import { existsSync, globSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { projectRoot } from './project.ts'
import { select, UsageError } from './runner.ts'

/** `// ...` and `/* ... *\/` comments, and commas before `}` or `]`. */
const plainJson = (text: string): string =>
  text
    .replace(/("(?:\\.|[^"\\])*")|\/\/.*|\/\*[\s\S]*?\*\//g, (_, string) => string ?? '')
    .replace(/,(\s*[}\]])/g, '$1')

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
  else fix(`Node ${v.node} is too old. ubq needs Node 24 or later. Install it, and put it first on the path.`)

  if (existsSync(join(root, 'package.json'))) ok(`project: ${root}`)
  else
    fix(
      `no package.json at or above ${root}. The folder of package.json is the project. Run: npm init -y`,
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
    if (!(error instanceof UsageError)) throw error
    fix(error.message)
  }

  // Files that look like test files, and that `ubq` does not run.
  const skip = (path: string): boolean =>
    /(^|[\\/])(node_modules$|\.)/.test(path) || existsSync(join(root, path, 'package.json'))
  const stray = globSync('**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}', { cwd: root, exclude: skip })
    .map(file => file.split('\\').join('/'))
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

  const tsconfig = join(root, 'tsconfig.json')
  if (existsSync(tsconfig)) {
    let options: Record<string, unknown> | undefined
    let inherits = false
    try {
      const json = JSON.parse(plainJson(readFileSync(tsconfig, 'utf8')))
      options = json.compilerOptions ?? {}
      inherits = 'extends' in json
    } catch {
      // Not a form that this check can read.
    }
    // A config that extends a different config can get the options from it.
    if (options && !inherits) {
      const missing = ['allowImportingTsExtensions', 'erasableSyntaxOnly'].filter(key => options[key] !== true)
      if (missing.length)
        fix(
          `tsconfig.json: set ${missing.map(key => `"${key}": true`).join(' and ')} in compilerOptions. Test files import source files with the .ts extension, and the runtime runs only TypeScript syntax that it can erase (no enum, no namespace, no parameter properties).`,
        )
      else ok('tsconfig.json')
    }
  }

  out(`doctor: ${problems} problems`)
  return problems
}
