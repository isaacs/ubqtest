// Type checks next to the tests: the runner starts the type checker
// of the project, and reports each error as an event.
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import type { TypeCheckError } from './events.ts'
import type { Checking } from './plain.ts'
import { projectRoot, rel, stateDir } from './project.ts'

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
 * The folders with a `tsconfig.json` that have a test file of the
 * run in them: the project root, and each folder from a test file
 * up to the root. A project with a second program in a folder (a
 * second Worker) has a config there for its files.
 */
const configFolders = (root: string, files: string[]): string[] => {
  const folders = new Set<string>()
  const add = (dir: string): void => {
    if (existsSync(join(dir, 'tsconfig.json'))) folders.add(dir)
  }
  add(root)
  for (const file of files)
    for (let dir = dirname(join(root, file)); dir.startsWith(root + sep); dir = dirname(dir)) add(dir)
  return [...folders]
}

/** Runs the checker on the config of one folder. */
const check = (
  tsc: string[],
  root: string,
  folder: string,
): { child?: ChildProcess; errors: Promise<TypeCheckError[]> } => {
  // The checker keeps its data for the next run. Each config has
  // its own file.
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
        folder,
      ],
      { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] },
    )
  } catch (error) {
    // On Windows, a file that is not a program throws here.
    return { errors: Promise.resolve(failed(error as Error)) }
  }
  const errors = new Promise<TypeCheckError[]>(done => {
    let text = ''
    child.stdout!.setEncoding('utf8').on('data', (data: string) => (text += data))
    const errors: TypeCheckError[] = []
    child.on('error', error => done(failed(error)))
    child.on('close', () => {
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
      // The expected value of an assertion has the type of the
      // actual value. The message of tsc names only a "parameter".
      for (const error of errors) {
        const source = error.at && read(error.at.file)
        if (!source) continue
        let at = 0
        for (let line = 1; line < error.at!.line; line++) at = source.indexOf('\n', at) + 1
        const method = expectedOf(source, at + error.at!.column - 1)
        if (method)
          error.message += `\nhint: this is the expected value of assert.${method}. It must have the type of the actual value. To compare two different types on purpose: assert.${method}<${method === 'equal' ? 'unknown, unknown' : 'unknown'}>(a, b)`
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
  const folders = tsc ? configFolders(root, files) : []
  if (!tsc || !folders.length) return undefined
  const checks = folders.map(folder => check(tsc, root, folder))
  type Handle = { ref?(): void; unref?(): void }
  const handles: Handle[] = checks.flatMap(({ child }) => (child ? [child, child.stdout as Handle] : []))
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
