// Type checks next to the tests: the runner starts the type checker
// of the project, and reports each error as an event.
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { TypeCheckError } from './events.ts'
import type { Checking } from './plain.ts'
import { projectRoot, rel, stateDir } from './project.ts'
import { listed, OWN_CONFIG, plainJson, type Tsconfig } from './tsconfig.ts'

/**
 * The `tsc` program of the project. Undefined if the project has
 * none. TypeScript 7 has a native program in a package for the
 * platform, and its `tsc` command is a Node program that starts it.
 * The native program starts 40 ms sooner with no Node program first.
 */
const compiler = (root: string): string[] | undefined => {
  try {
    const require = createRequire(join(root, 'package.json'))
    const manifest = require.resolve('typescript/package.json')
    // The package is for the CPU of the machine. The runtime can be
    // for a different one: an x64 program on an ARM machine.
    for (const arch of new Set([process.arch, 'arm64', 'x64'])) {
      try {
        const native = createRequire(manifest).resolve(
          `@typescript/typescript-${process.platform}-${arch}/package.json`,
        )
        const exe = join(dirname(native), 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc')
        if (existsSync(exe)) return [exe]
      } catch {
        // An older TypeScript has no native program.
      }
    }
    // The command file is a JavaScript program. Windows cannot start
    // it with no runtime.
    const bin = (JSON.parse(readFileSync(manifest, 'utf8')) as { bin?: { tsc?: string } }).bin?.tsc
    return bin
      ? [process.execPath, ...(process.versions.deno ? ['run', '-A'] : []), join(dirname(manifest), bin)] // ubq: not measured: the tests run the command line on Node
      : undefined // ubq: not measured: the package of typescript has a bin
  } catch {
    return undefined
  }
}

// `src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.`
const ERROR = /^(?:(.+)\((\d+),(\d+)\): )?error (TS\d+): (.*)$/

/**
 * The method of an assertion, if `at` (from 0) is in its expected
 * value: `assert.deepEqual(actual, <here>)`. The scan goes back out
 * of each object and array literal to the call. Text in strings is
 * not known to the scan.
 */
export const expectedOf = (source: string, at: number): string | undefined => {
  let depth = 0
  let second = false
  for (let i = at - 1; i >= 0; i--) {
    const c = source[i]!
    if (c === ')' || c === ']' || c === '}') depth++
    else if (c === '[' || c === '{') {
      if (depth) depth--
      // Out of a literal: a comma in it is not one of the call.
      else second = false
    } else if (c === '(') {
      if (depth) depth--
      else
        return second ? /\bassert\.(equal|notEqual|deepEqual)(<[^>]*>)?\s*$/.exec(source.slice(0, i))?.[1] : undefined
    } else if (c === ',' && !depth) second = true
  }
  return undefined
}

/**
 * The config that ubq makes for a folder whose `tsconfig.json` has
 * only references to other configs, as each project of Nx has
 * (D110). `tsc -p` of such a file reads no file. The new config
 * extends the referenced config of the folder that has a test
 * file of `files` (absolute paths). `extends` does not copy
 * `references`, so the checker reads the source of the other
 * projects, and they need no build. Undefined if the folder has no
 * such config.
 */
export const ownConfig = (folder: string, files: string[]): { base: string; text: string } | undefined => {
  // Undefined for a file that is absent, or that this code cannot
  // read: the checker reports it.
  const read = (file: string): Tsconfig | undefined => {
    try {
      const text = readFileSync(file, 'utf8')
      // Most configs have no references: no parse for them.
      return file.endsWith(`${sep}tsconfig.json`) && !text.includes('"references"')
        ? undefined
        : (JSON.parse(plainJson(text)) as Tsconfig)
    } catch {
      return undefined
    }
  }
  const json = read(join(folder, 'tsconfig.json'))
  if (!json || !Array.isArray(json.files) || json.files.length || json.include?.length) return undefined
  const inside = files.filter(file => file.startsWith(folder + sep))
  for (const { path } of json.references ?? []) {
    const base = resolve(folder, path)
    const config = dirname(base) === folder && base.endsWith('.json') ? read(base) : undefined
    if (!config || !inside.some(file => listed(config, folder, file))) continue
    // A path of `paths` can go to a different project. With the
    // root of the monorepo as `rootDir`, that is not TS6059. The
    // base config of the monorepo is at its root.
    let top = folder
    const up = (file: string, config: Tsconfig | undefined): void => {
      for (const name of [config?.extends ?? []].flat()) {
        const next = resolve(dirname(file), name.endsWith('.json') ? name : `${name}.json`)
        if (folder.startsWith(dirname(next) + sep) && dirname(next).length < top.length) top = dirname(next)
        // A config of the folder extends the tsconfig.json of the folder.
        if (next !== join(folder, 'tsconfig.json')) up(next, read(next))
        else up(next, json)
      }
    }
    up(base, config)
    const options = { composite: false, noEmit: true, rootDir: relative(folder, top).split(sep).join('/') || '.' }
    return {
      base,
      text: `// ubq made this file for its type check. The tsconfig.json of this
// folder has only "references", and "tsc --noEmit -p" of it reads
// no file. Change this file as the project needs, and commit it.
${JSON.stringify({ extends: `./${relative(folder, base)}`, compilerOptions: options }, null, 2)}
`,
    }
  }
  return undefined
}

/**
 * The config files that have a test file of the run in their
 * folder: one of the project root, and one of each folder from a
 * test file up to the root. A project with a second program in a
 * folder (a second Worker) has a config there for its files. The
 * file of a folder is `tsconfig.ubq.json`, or `tsconfig.json`.
 */
const configFiles = (root: string, files: string[]): string[] => {
  const configs = new Map<string, string>()
  const paths = files.map(file => join(root, file))
  const add = (dir: string): void => {
    if (configs.has(dir) || !existsSync(join(dir, 'tsconfig.json'))) return
    const own = join(dir, OWN_CONFIG)
    const made = existsSync(own) ? undefined : ownConfig(dir, paths)
    if (made)
      try {
        writeFileSync(own, made.text)
        process.stderr.write(
          `note: ubq wrote ${rel(own)} for its type check. ${rel(join(dir, 'tsconfig.json'))} has only "references", and "tsc -p" of it reads no file. The new file extends ${rel(made.base)}. Commit it.\n`,
        )
      } catch {
        // ubq: not measured: a folder that the run cannot write to
      }
    configs.set(dir, existsSync(own) ? own : join(dir, 'tsconfig.json'))
  }
  add(root)
  for (const file of paths) for (let dir = dirname(file); dir.startsWith(root + sep); dir = dirname(dir)) add(dir)
  return [...configs.values()]
}

/** Runs the checker on one config file. */
const check = (
  tsc: string[],
  root: string,
  config: string,
): { child?: ChildProcess; errors: Promise<TypeCheckError[]> } => {
  // The checker keeps its data for the next run. Each config has
  // its own file.
  const folder = dirname(config)
  const name = folder === root ? 'tsbuildinfo' : `tsbuildinfo-${rel(folder).replaceAll('/', '-')}`
  const failed = (error: Error): TypeCheckError[] => [
    { type: 'type-error', code: 'ubq', message: `the type checker did not start: ${error.message}` },
  ]
  let child: ChildProcess
  try {
    child = spawn(
      tsc[0]!,
      [
        ...tsc.slice(1),
        '--noEmit',
        '--pretty',
        'false',
        '--incremental',
        '--tsBuildInfoFile',
        join(stateDir(), 'types', name),
        '-p',
        config,
      ],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (error) {
    // On Windows, a file that is not a program throws here.
    return { errors: Promise.resolve(failed(error as Error)) }
  }
  const errors = new Promise<TypeCheckError[]>(done => {
    let text = ''
    let stderr = ''
    child.stdout!.setEncoding('utf8').on('data', (data: string) => (text += data))
    child.stderr!.setEncoding('utf8').on('data', (data: string) => (stderr += data))
    const errors: TypeCheckError[] = []
    child.on('error', error => done(failed(error)))
    child.on('close', (code, signal) => {
      const sources = new Map<string, string | undefined>()
      const read = (file: string): string | undefined => {
        if (!sources.has(file))
          try {
            sources.set(file, readFileSync(resolve(root, file), 'utf8'))
          } catch {
            // ubq: not measured: tsc names files that exist
            sources.set(file, undefined)
          }
        return sources.get(file)
      }
      for (const line of text.split('\n')) {
        const m = ERROR.exec(line)
        if (m)
          errors.push({
            type: 'type-error',
            code: m[4]!,
            message: m[5]!,
            ...(m[1] && { at: { file: rel(resolve(root, m[1])), line: +m[2]!, column: +m[3]! } }),
          })
        // More lines of the same message have an indent.
        else if (line.startsWith(' ') && errors.length) errors.at(-1)!.message += '\n' + line.trim()
      }
      // A checker that the system stopped, or that failed, has no
      // result. No errors from it does not mean that the types are
      // correct.
      if (signal || (code && !errors.length))
        errors.push({
          type: 'type-error',
          code: 'ubq',
          message: `the type checker of ${rel(config)} stopped with ${signal ?? `exit code ${code}`}, and its result is not complete. Run again.${stderr.trim() ? '\n' + stderr.trim().slice(-500) : ''}`,
        })
      // The expected value of an assertion has the type of the
      // actual value. The message of tsc names only a "parameter".
      for (const error of errors) {
        // The option that reports this syntax is for Node.
        if (error.code === 'TS1294')
          error.message +=
            '\nhint: Node cannot run this syntax with only its types removed. Change this syntax, or run `ubq doctor`: it has the three other choices for the person who owns the project.'
        if (error.code === 'TS6305')
          error.message +=
            '\nhint: the tsconfig has "references", and the checker reads a referenced project from its build output, which is not there or is old. Build the referenced projects (tsc -b), in CI too, before the tests.'
        const source = error.at && read(error.at.file)
        if (!source) continue
        let at = 0
        for (let line = 1; line < error.at!.line; line++) at = source.indexOf('\n', at) + 1
        const method = expectedOf(source, at + error.at!.column - 1)
        if (method)
          error.message += `\nhint: this is the expected value of assert.${method}. It must have the type of the actual value. To compare two different types on purpose: assert.${method}<unknown>(a, b)`
      }
      done(errors)
    })
  })
  return { child, errors }
}

/**
 * Runs `tsc --noEmit` on each `tsconfig.json` of the project that
 * has a test file of the run in its folder (D49). `files` are the
 * test files of the run, as paths from the project root. Returns
 * undefined if the project has no such config, or no `typescript`
 * package.
 *
 * With `background`, the checker does not keep the process open:
 * a test file that runs in this process must see when its own work
 * ends. `wait` of the result keeps the process open for the checker.
 */
export const typeCheck = (background = false, files: string[] = []): Checking | undefined => {
  const root = projectRoot()
  const tsc = compiler(root)
  const configs = tsc ? configFiles(root, files) : []
  if (!tsc || !configs.length) return undefined
  const checks = configs.map(config => check(tsc, root, config))
  type Handle = { ref?(): void; unref?(): void }
  const handles: Handle[] = checks.flatMap(({ child }) =>
    child ? [child, child.stdout as Handle, child.stderr as Handle] : [],
  )
  if (background) for (const h of handles) h.unref?.()
  return {
    // Two configs can have the same file.
    errors: Promise.all(checks.map(one => one.errors)).then(lists => {
      const seen = new Set<string>()
      return lists.flat().filter(error => {
        const key = JSON.stringify([error.at, error.code, error.message])
        return !seen.has(key) && !!seen.add(key)
      })
    }),
    wait() {
      for (const h of handles) h.ref?.()
    },
  }
}
