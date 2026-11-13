import { DurableObject } from 'cloudflare:workers'
import { shout } from './text'

export interface Env {
  GREETING: string
  DB: D1Database
  COUNTER: DurableObjectNamespace<Counter>
}

export class Counter extends DurableObject {
  async add(): Promise<number> {
    const n = ((await this.ctx.storage.get<number>('n')) ?? 0) + 1
    await this.ctx.storage.put('n', n)
    return n
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url)
    ctx.waitUntil(env.DB.prepare('INSERT INTO log (path) VALUES (?)').bind(pathname).run())
    if (pathname === '/notes') {
      const { results } = await env.DB.prepare('SELECT text, words FROM notes ORDER BY id').all()
      return Response.json(results)
    }
    if (pathname === '/count') return Response.json(await env.COUNTER.get(env.COUNTER.idFromName('a')).add())
    if (pathname === '/agent') return new Response(navigator.userAgent)
    if (pathname === '/never') return new Response('this line has no test')
    return new Response(shout(env.GREETING))
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await env.DB.prepare('INSERT INTO notes (text) VALUES (?)').bind(`cron ${controller.cron}`).run()
  },
} satisfies ExportedHandler<Env>
