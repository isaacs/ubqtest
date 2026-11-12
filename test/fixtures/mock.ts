// Module mocks.
import { assert, mockImport, spy, test } from 'ubqtest'
import { greet } from './src/greet.ts'

test('a mock replaces a dependency in a new instance of the module', async () => {
  const fetchUser = spy(async (id: number) => ({ id, name: 'ada' }))
  const mocked = await mockImport(() => import('./src/greet.ts'), [
    [() => import('./src/db.ts'), { fetchUser, table: 'users' }],
  ])
  assert.equal(await mocked.greet(7), 'hello ada')
  assert.deepEqual(fetchUser.calls[0]?.args, [7])
  // The real module is a different instance, with its own state.
  assert.equal(await greet(7), 'hello user 7')
  assert.deepEqual([mocked.count(), (await import('./src/greet.ts')).count()], [1, 1])
  // The real dependency is not a stub, also after it was a mock loader.
  assert.equal((await import('./src/db.ts')).table, 'users')
})

test('a mock reaches the modules that the module imports, and builtins', async () => {
  const mocked = await mockImport(() => import('./src/greet.ts'), [
    [() => import('./src/db.ts'), { fetchUser: async id => ({ id, name: 'bob' }), table: 'people' }],
    [() => import('node:fs'), { readFileSync: () => '{}' }],
  ])
  assert.equal(await mocked.greet(1), 'hello from people, bob')
  assert.equal(mocked.config(), '{}')
})

test('a mock that lacks an export', async () => {
  await mockImport(() => import('./src/greet.ts'), [[() => import('./src/db.ts'), { table: 'x' }]])
  assert.fail('not reached')
})

test('a loader that is not an import', async () => {
  const real = await import('./src/greet.ts')
  await mockImport(() => Promise.resolve(real), [])
  assert.fail('not reached')
})
