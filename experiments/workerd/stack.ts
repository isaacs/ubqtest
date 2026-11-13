import { helper } from './helper.ts'
const fail = (): string => new Error('x').stack ?? ''
export const run = async (): Promise<unknown> => {
  const t = setTimeout(() => {}, 1)
  let cjs: unknown
  try { cjs = Object.keys(await import('./dep.cjs')) } catch (e) { cjs = String(e) }
  return { stack: fail().split('\n'), helper: helper(1), timer: typeof t, unref: typeof (t as { unref?: unknown }).unref, proc: typeof process, argv: process.argv, cwd: process.cwd(), cjs, meta: typeof import.meta.url }
}
