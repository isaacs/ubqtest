// The module that workerd runs for a test file of a Worker. The
// host process (`workers-host.ts`) sends one request with the job.
// The response is the events of the file, as JSON lines.
// See docs/02-decisions.md, D48.
import { subscribe } from 'node:diagnostics_channel'
import { format } from 'node:util'
import type { Config } from './config.ts'
import { COUNTERS } from './counters.ts'
import { CHANNEL } from './emit.ts'
import { RUN, WORKERD, type Workerd } from './workerd.ts'

export interface Job {
  /** The test file, as workerd names it. */
  path: string
  root: string
  config: Config
  /** The variables that the runner gives to a test process. */
  env: Record<string, string>
  migrations: Workerd['migrations']
}

/** Counts that the host changes to ranges: it has the regions. */
export interface RawCoverage {
  file: string
  counts: number[]
}

const shared = globalThis as Record<symbol, unknown>

// The code of a project file asks for its counters by name and
// count. The main module of the Worker loads when workerd starts,
// before the first request, and after this module.
const counters = new Map<string, Uint32Array>()
shared[Symbol.for(COUNTERS)] = {
  get(file: string, size: number): Uint32Array {
    let counts = counters.get(file)
    if (counts?.length !== size) counters.set(file, (counts = new Uint32Array(size)))
    return counts
  },
}
shared[Symbol.for('ubqtest.collector')] = {
  mode: 'full',
  async take(): Promise<RawCoverage[]> {
    const files: RawCoverage[] = []
    for (const [file, counts] of counters) {
      if (!counts.some(Boolean)) continue
      files.push({ file, counts: [...counts] })
      counts.fill(0)
    }
    return files
  },
}

/** The name of the binding that sends events to the host process. */
export const HOST = '__UBQ_HOST'

export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    const job = (await request.json()) as Job
    // Events wait here until `flush` sends them. A request that the
    // host answers is the only way to know that the host has them.
    const queue: string[] = []
    const send = (event: unknown): void => void queue.push(JSON.stringify(event))
    const flush = async (): Promise<void> => {
      if (!queue.length) return
      const body = queue.splice(0).join('\n')
      await (env[HOST] as { fetch(url: string, init: object): Promise<Response> }).fetch('http://ubq/', { method: 'POST', body })
    }
    const host: Workerd = { root: job.root, config: job.config, env, migrations: job.migrations, flush }
    shared[WORKERD] = host
    Object.assign(process.env, job.env)
    subscribe(CHANNEL, send)
    // The console of workerd does not write through `process.stdout`,
    // so the capture of the test API does not see it.
    const state = (): { current: { getStore(): { id: string } | undefined } } | undefined =>
      shared[Symbol.for('ubqtest.state')] as ReturnType<typeof state>
    for (const [method, stream] of [['log', 'stdout'], ['info', 'stdout'], ['debug', 'stdout'], ['warn', 'stderr'], ['error', 'stderr']] as const)
      console[method] = (...args: unknown[]): void => {
        const id = state()?.current.getStore()?.id
        send({ type: 'output', file: job.env.UBQ_FILE, ...(id && { id }), stream, text: format(...args) + '\n' })
      }
    try {
      const loaded = (await import(job.path)) as { [RUN]?: () => Promise<void> }
      await loaded[RUN]?.()
      await host.finish?.()
    } catch (error) {
      send({ type: 'load-error', text: String((error as Error)?.stack ?? error) })
    }
    await flush()
    return new Response('done')
  },
}
