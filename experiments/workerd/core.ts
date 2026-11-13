import { assert, test } from '../../src/index.ts'
export const run = async (): Promise<unknown> => {
  test('adds', () => { assert.equal(1 + 1, 2) })
  await new Promise(r => setTimeout(r, 200))
  return { ok: true }
}
