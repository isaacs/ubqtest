// Type checks next to the tests: the runner starts the type checker
// of the project, and reports each error as an event.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import type { TypeCheckError } from './events.ts'
import { projectRoot, rel, stateDir } from './project.ts'

/** The `tsc` program of the project. Undefined if the project has none. */
const compiler = (root: string): string | undefined => {
  try {
    const manifest = createRequire(join(root, 'package.json')).resolve('typescript/package.json')
    const bin = (JSON.parse(readFileSync(manifest, 'utf8')) as { bin?: { tsc?: string } }).bin?.tsc
    return bin && join(dirname(manifest), bin)
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
 */
export const typeCheck = (): Promise<TypeCheckError[]> | undefined => {
  const root = projectRoot()
  const tsc = compiler(root)
  if (!tsc || !existsSync(join(root, 'tsconfig.json'))) return undefined
  return new Promise(done => {
    const info = join(stateDir(), 'types', 'tsbuildinfo')
    const child = spawn(
      tsc,
      ['--noEmit', '--pretty', 'false', '--incremental', '--tsBuildInfoFile', info, '-p', root],
      { cwd: root },
    )
    let text = ''
    child.stdout.setEncoding('utf8').on('data', (data: string) => (text += data))
    child.stderr.resume()
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
}
