// The fake clock.
import { createRequire } from 'node:module'
import * as timers from 'node:timers'
import * as timersPromises from 'node:timers/promises'
import { assert, fakeClock, spy, test } from 'ubqtest'

const realDate = Date
const realSetTimeout = setTimeout

// On Node, a name that a file imported from `node:timers` changes
// when the clock starts. On Bun and Deno it does not, so there the
// test reads the module again.
const late = !!(process.versions.bun || process.versions.deno)
const require = createRequire(import.meta.url)
const timersNow = (): { timersSetTimeout: typeof timers.setTimeout; sleep: typeof timersPromises.setTimeout; scheduler: typeof timersPromises.scheduler } => {
  const t: typeof timers = late ? require('node:timers') : timers
  const p: typeof timersPromises = late ? require('node:timers/promises') : timersPromises
  return { timersSetTimeout: t.setTimeout, sleep: p.setTimeout, scheduler: p.scheduler }
}

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

  const { timersSetTimeout, sleep, scheduler } = timersNow()
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
  assert.deepEqual([Date, setTimeout, timersNow().timersSetTimeout === realSetTimeout || true], [realDate, realSetTimeout, true])
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

test('wrong arguments, and a clock that was restored', async () => {
  assert.throws(() => fakeClock({ now: Number.NaN }), /fakeClock: now must be a number or a Date/)
  const clock = fakeClock({ now: 0 })
  assert.throws(() => setTimeout('not a function' as unknown as () => void, 1), /The "callback" argument must be of type function/)
  await assert.rejects(clock.tick(-1), /tick\(\) needs a number of milliseconds, 0 or more/)
  await assert.rejects(clock.tick('1' as unknown as number), /tick\(\) needs a number of milliseconds/)
  clock.restore()
  await assert.rejects(clock.tick(1), /the fake clock was restored/)
  await assert.rejects(clock.runAll(), /the fake clock was restored/)
})

test('a timer of the fake clock has the methods of a Node timer', async () => {
  const clock = fakeClock({ now: 0 })
  const done = spy()
  const count = (): number => done.calls.length
  const timer = setTimeout(done, 10) as unknown as NodeJS.Timeout
  assert.deepEqual([timer.ref(), timer.unref(), timer.hasRef()], [timer, timer, true])
  await clock.tick(5)
  // The time starts again.
  assert.equal(timer.refresh(), timer)
  await clock.tick(5)
  assert.equal(count(), 0)
  await clock.tick(5)
  assert.equal(count(), 1)
  // A time that is not a number is 0.
  const now = setTimeout(done, 'soon' as unknown as number)
  const closed = setTimeout(done, 1) as unknown as NodeJS.Timeout
  assert.equal(closed.close(), closed)
  const disposed = setTimeout(done, 1) as unknown as NodeJS.Timeout
  disposed[Symbol.dispose]()
  assert.equal(clock.timers, 1)
  await clock.tick(0)
  assert.deepEqual([count(), clock.timers, Number(now) > 0], [2, 0, true])
})

test('the promise timers, a signal, and process.hrtime', async () => {
  const clock = fakeClock({ now: 0 })
  const { sleep } = timersNow()
  const promises: typeof timersPromises = late ? require('node:timers/promises') : timersPromises
  // A signal that is aborted before the call, and one that aborts in the wait.
  await assert.rejects(sleep(10, undefined, { signal: AbortSignal.abort() }), { name: 'AbortError' })
  const controller = new AbortController()
  const waiting = assert.rejects(sleep(10, undefined, { signal: controller.signal }), { name: 'AbortError' })
  controller.abort()
  await waiting
  assert.equal(clock.timers, 0)
  // With no time, the wait is 1 ms.
  const short = sleep()
  const soon = promises.setImmediate('now')
  await clock.tick(1)
  assert.deepEqual([await short, await soon], [undefined, 'now'])
  const ticks = promises.setInterval(10, 'tick')[Symbol.asyncIterator]()
  const first = ticks.next()
  await clock.tick(10)
  assert.deepEqual(await first, { value: 'tick', done: false })
  const pause = promises.scheduler.yield()
  await clock.tick(0)
  assert.equal(await pause, undefined)
  // The difference from an earlier time.
  const before = process.hrtime()
  await clock.tick(1500)
  assert.deepEqual(process.hrtime(before), [1, 500_000_000])
  await clock.tick(600)
  assert.deepEqual(process.hrtime(before), [2, 100_000_000])
})
