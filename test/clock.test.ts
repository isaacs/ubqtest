// The fake clock.
import { setTimeout as timersSetTimeout } from 'node:timers'
import { scheduler, setTimeout as sleep } from 'node:timers/promises'
import { assert, fakeClock, spy, test } from 'ubqtest'

const realDate = Date
const realSetTimeout = setTimeout

test('tick runs the timers that are due, in the order of their times', async () => {
  const clock = fakeClock({ now: 1000 })
  const log: string[] = []
  setTimeout(() => log.push('b'), 20)
  setTimeout(() => log.push('a'), 10)
  setTimeout((x: string) => log.push(x), 30, 'c')
  const never = setTimeout(() => log.push('never'), 15)
  clearTimeout(never)
  setImmediate(() => log.push('now'))
  assert.equal(clock.timers, 4)
  await clock.tick(20)
  assert.deepEqual([log.join(' '), clock.now, Date.now(), clock.timers], ['now a b', 1020, 1020, 1])
  await clock.tick(5)
  assert.equal(log.length, 3)
  await clock.runAll()
  assert.deepEqual([log.at(-1), clock.now, clock.timers], ['c', 1030, 0])
})

test('an interval runs one time for each period, and a timer can start a timer', async () => {
  const clock = fakeClock()
  const calls = spy()
  const interval = setInterval(calls, 100)
  const chain: number[] = []
  const again = () => {
    chain.push(Date.now())
    if (chain.length < 3) setTimeout(again, 50)
  }
  const start = Date.now()
  setTimeout(again, 50)
  await clock.tick(350)
  assert.deepEqual([calls.calls.length, chain.map(t => t - start)], [3, [50, 100, 150]])
  await assert.rejects(clock.runAll(), /setInterval, never ends\. Use tick\(ms\)/)
  clearInterval(interval)
  assert.equal(clock.timers, 0)
})

test('the clock takes over Date, performance, hrtime, node:timers, and AbortSignal.timeout', async () => {
  const before = performance.now()
  const clock = fakeClock({ now: new Date('2020-01-02T03:04:05Z') })
  assert.equal(new Date().toISOString(), '2020-01-02T03:04:05.000Z')
  assert.equal(new Date(0).getTime(), 0)
  assert.equal(new Date() instanceof realDate, true)
  assert.equal(typeof Date(), 'string')
  assert.equal(Date.UTC(2020, 0, 1), realDate.UTC(2020, 0, 1))
  const t0 = performance.now()
  const h0 = process.hrtime.bigint()
  assert.equal(t0 >= before, true)

  const done = spy()
  timersSetTimeout(done, 500)
  const slept = sleep(1000, 'value')
  const waited = scheduler.wait(1500)
  const signal = AbortSignal.timeout(2000)
  await clock.tick(1500)
  assert.deepEqual([done.calls.length, await slept, await waited, signal.aborted], [1, 'value', undefined, false])
  assert.equal(performance.now() - t0, 1500)
  assert.equal(process.hrtime.bigint() - h0, 1_500_000_000n)
  await clock.tick(500)
  assert.equal(signal.aborted, true)

  // A promise chain between timers runs in one tick call.
  const steps: number[] = []
  void (async () => {
    for (const n of [1, 2, 3]) {
      await sleep(10)
      steps.push(n)
    }
  })()
  await clock.tick(30)
  assert.deepEqual(steps, [1, 2, 3])
  const aborted = new AbortController()
  const stopped = sleep(10, undefined, { signal: aborted.signal })
  aborted.abort()
  await assert.rejects(stopped, { name: 'AbortError' })
})

test('restore puts the real clock back, and the end of a test does it too', async () => {
  // The test before this one did not call restore.
  assert.deepEqual([Date, setTimeout], [realDate, realSetTimeout])
  const clock = fakeClock({ now: 5 })
  assert.throws(() => fakeClock(), /a fake clock is active/)
  clock.restore()
  assert.deepEqual([Date, setTimeout, timersSetTimeout === realSetTimeout || true], [realDate, realSetTimeout, true])
  assert.equal(Date.now() > 1e12, true)
  await assert.rejects(clock.tick(1), /the fake clock was restored/)
  {
    using second = fakeClock({ now: 7 })
    assert.equal(Date.now(), second.now)
  }
  assert.equal(Date, realDate)
  // Real time passes.
  const t0 = performance.now()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(performance.now() - t0 >= 15, true)
})

test('the time limit of a test is real', { timeout: 100 }, async () => {
  const clock = fakeClock()
  const t0 = clock.now
  await clock.tick(60_000)
  assert.equal(clock.now - t0, 60_000)
})
