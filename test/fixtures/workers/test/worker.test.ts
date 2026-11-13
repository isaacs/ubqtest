import { env } from 'cloudflare:workers'
import { assert, describe, test } from 'ubqtest'
import { executionContext, migrate, scheduledController } from 'ubqtest/workers'
import worker, { type Env } from '../src/index.js'

const bindings = env as unknown as Env
await migrate('DB')

const get = async (path: string): Promise<Response> => {
  const ctx = executionContext()
  const response = await worker.fetch(new Request(`http://example.com${path}`), bindings, ctx)
  await ctx.settled()
  return response
}

describe('fetch', () => {
  test('a greeting from a var', async () => {
    assert.equal(await (await get('/')).text(), 'HELLO!')
  })

  test('the runtime is workerd', async () => {
    assert.equal(await (await get('/agent')).text(), 'Cloudflare-Workers')
  })

  test('rows from D1, with the migrations and the trigger', async () => {
    assert.deepEqual(await (await get('/notes')).json(), [{ text: 'the first note', words: 3 }])
  })

  test('waitUntil work is done after settled()', async () => {
    const { results } = await bindings.DB.prepare('SELECT DISTINCT path FROM log ORDER BY path').all()
    assert.deepEqual(results, [{ path: '/' }, { path: '/agent' }, { path: '/notes' }])
  })

  test('a Durable Object', async () => {
    assert.deepEqual([await (await get('/count')).json(), await (await get('/count')).json()], [1, 2])
  })
})

test('scheduled', async () => {
  await worker.scheduled(scheduledController({ cron: '0 * * * *' }), bindings)
  const row = await bindings.DB.prepare("SELECT text FROM notes WHERE text LIKE 'cron%'").first()
  assert.deepEqual(row, { text: 'cron 0 * * * *' })
  // The parts that do nothing in a test, and a second migrate call,
  // which applies nothing.
  const controller = scheduledController() as unknown as { cron: string; noRetry(): void }
  controller.noRetry()
  ;(executionContext() as unknown as { passThroughOnException(): void }).passThroughOnException()
  await migrate('DB')
  assert.equal(controller.cron, '')
})
