// `ubqtest/workers`: helpers for the tests of a Cloudflare Worker.
// The test file runs in workerd. See docs/02-decisions.md, D48.
import { cleanup } from './fixtures.ts'
import { workerd, type Workerd } from './workerd.ts'

declare global {
  // The project gives these their members, with the types of
  // Workers (`wrangler types` or `@cloudflare/workers-types`).
  interface ExecutionContext {}
  interface ScheduledController {}
}

const host = (name: string): Workerd => {
  const found = workerd()
  if (!found)
    throw new Error(
      `${name} works only in a test file that runs in the Workers runtime. Add the file to "workers" in the "ubq" key of package.json.`,
    )
  return found
}

/**
 * Makes the third argument of a handler: `worker.fetch(request,
 * env, ctx)`. `await ctx.settled()` waits for the promises that
 * the handler gave to `ctx.waitUntil`. The test also waits for
 * them when it ends.
 */
export const executionContext = (): ExecutionContext & { settled(): Promise<void> } => {
  host('executionContext')
  const pending: Promise<unknown>[] = []
  const ctx = {
    waitUntil(promise: Promise<unknown>): void {
      pending.push(Promise.resolve(promise))
    },
    passThroughOnException(): void {},
    props: {},
    async settled(): Promise<void> {
      // A promise can add more promises.
      while (pending.length) await Promise.allSettled(pending.splice(0))
    },
  }
  cleanup(() => ctx.settled())
  return ctx as ExecutionContext & { settled(): Promise<void> }
}

/** Makes the first argument of a `scheduled` handler. */
export const scheduledController = (options: { scheduledTime?: number; cron?: string } = {}): ScheduledController => {
  host('scheduledController')
  return {
    scheduledTime: options.scheduledTime ?? Date.now(),
    cron: options.cron ?? '',
    noRetry(): void {},
  } as ScheduledController
}

interface Statement {
  run(): Promise<unknown>
  all(): Promise<{ results: Record<string, unknown>[] }>
  bind(...values: unknown[]): Statement
}
interface Database {
  prepare(query: string): Statement
  batch(statements: Statement[]): Promise<unknown>
}

/**
 * Applies the migrations of a D1 database to its local copy.
 * `binding` is the name of the database in the wrangler config,
 * such as `'DB'`. The files come from its `migrations_dir`.
 */
export const migrate = async (binding: string): Promise<void> => {
  const { env, migrations } = host('migrate')
  const db = env[binding] as Database | undefined
  const list = migrations[binding]
  if (!db || !list)
    throw new Error(`migrate: the wrangler config has no D1 database with the binding ${JSON.stringify(binding)}`)
  // The table that `wrangler d1 migrations apply` uses.
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)',
    )
    .run()
  const done = new Set((await db.prepare('SELECT name FROM d1_migrations').all()).results.map(row => row.name))
  for (const { name, queries } of list) {
    if (done.has(name)) continue
    await db.batch([
      ...queries.map(query => db.prepare(query)),
      db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name),
    ])
  }
}
