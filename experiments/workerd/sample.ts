import { DurableObject } from 'cloudflare:workers'
import { helper } from './helper.ts'
export class Counter extends DurableObject {}
export const run = async (env: { DB: D1Database }): Promise<unknown> => ({
  helper: helper(2),
  nav: navigator.userAgent,
  one: await env.DB.prepare('SELECT 1 AS one').first(),
  base: typeof DurableObject,
})
