// Type checks next to the tests: the runner starts the type checker
// of the project, and reports each error as an event.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
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
        const native = createRequire(manifest).resolve(`@typescript/typescript-${process.platform}-${arch}/package.json`)
        const exe = join(dirname(native), 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc')
        if (existsSync(exe)) return [exe]
      } catch {
        // An older TypeScript has no native program.
      }
    }
    // The command file is a JavaScript program. Windows cannot start
    // it with no runtime.
    const bin = (JSON.parse(readFileSync(manifest, 'utf8')) as { bin?: { tsc?: string } }).bin?.tsc
    return bin ? [process.execPath, ...(process.versions.deno ? ['run', '-A'] : []), join(dirname(manifest), bin)] : undefined
  } catch {
    return undefined
  }
}

// `src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.`
const ERROR = /^(?:(.+)\((\d+),(\d+)\): )?error (TS\d+): (.*)$/

/**
 * Runs `tsc --noEmit` on the `tsconfig.json` of the project root.
 * The checker keeps its data for the next run in `.ubq/types/`.
 * Returns undefined if the project has no `tsconfig.json` there, or
 * no `typescript` package.
 *
 * With `background`, the checker does not keep the process open:
 * a test file that runs in this process must see when its own work
 * ends. `wait` of the result keeps the process open for the checker.
 */
export const typeCheck = (background = false): Checking | undefined => {
  const root = projectRoot()
  const tsc = compiler(root)
  if (!tsc || !existsSync(join(root, 'tsconfig.json'))) return undefined
  const info = join(stateDir(), 'types', 'tsbuildinfo')
  const child = spawn(
    tsc[0]!,
    [...tsc.slice(1), '--noEmit', '--pretty', 'false', '--incremental', '--tsBuildInfoFile', info, '-p', root],
    { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  type Handle = { ref?(): void; unref?(): void }
  const handles: Handle[] = [child, child.stdout as Handle]
  if (background) for (const h of handles) h.unref?.()
  const errors = new Promise<TypeCheckError[]>(done => {
    let text = ''
    child.stdout.setEncoding('utf8').on('data', (data: string) => (text += data))
    const errors: TypeCheckError[] = []
    child.on('error', error =>
      done([{ type: 'type-error', code: 'ubq', message: `the type checker did not start: ${error.message}` }]),
    )
    child.on('close', () => {
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
      done(errors)
    })
  })
  return {
    errors,
    wait() {
      for (const h of handles) h.ref?.()
    },
  }
}
