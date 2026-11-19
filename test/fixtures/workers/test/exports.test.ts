import { exports } from 'cloudflare:workers'
import { assert, test } from 'ubqtest'
import { hits } from '../src/index.js'

test('exports.default.fetch calls the Worker of the wrangler config, in the isolate of the test', async () => {
  const before = hits()
  const response = await exports.default.fetch('http://example.com/hit')
  // The handler gets the bindings of the config, and not the
  // binding that ubq uses.
  const body = (await response.json()) as { hits: number; env: string[] }
  assert.equal(body.hits, before + 1)
  assert.contains(body.env, 'GREETING')
  assert.deepEqual(
    body.env.filter(name => /ubq/i.test(name)),
    [],
  )
  assert.equal(hits(), before + 1)
  const posted = await exports.default.fetch(new Request('http://example.com/', { method: 'POST' }))
  assert.equal(await posted.text(), 'HELLO!')
})
