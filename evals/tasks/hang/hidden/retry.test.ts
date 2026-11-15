import { assert, test } from 'ubqtest'
import { retry } from '../src/retry.ts'

const failing = (times: number) => {
  let calls = 0
  return () => (++calls <= times ? Promise.reject(new TypeError(`call ${calls}`)) : Promise.resolve(calls))
}

test('a value', async () => assert.equal(await retry(() => Promise.resolve(1), 3), 1))
test('a value after two errors', async () => assert.equal(await retry(failing(2), 3), 3))
test('the last error', async () => void (await assert.rejects(retry(failing(5), 2), /call 2/)))
test('no tries', async () => void (await assert.rejects(retry(failing(0), 0), RangeError)))
test('fewer than no tries', async () => void (await assert.rejects(retry(failing(0), -1), RangeError)))
test('one try', async () => void (await assert.rejects(retry(failing(1), 1), /call 1/)))
