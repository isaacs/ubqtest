// The public API. See docs/05-api.md.
import { startCapture } from './capture.ts'
import { setDefines } from './config.ts'
import { startCoverage } from './coverage.ts'
import { type Files, makeTestdir } from './fixtures.ts'
import { startPlain } from './plain.ts'
import { startPipe } from './sink-pipe.ts'
import { setUpdate } from './snapshot.ts'
import { currentFile, setCollector } from './test.ts'

export { assert, type Assert, isDeepEqual, isMatch, type Pattern } from './assert.ts'
export { fakeClock, type FakeClock, type FakeClockOptions } from './clock.ts'
export { cleanup, env, stub, type Files } from './fixtures.ts'
export { mockImport, type MockOf } from './mock.ts'
export { spy, spyOn, type Spy, type SpyCall, type SpyFunction } from './spy.ts'
export { describe, test, type TestContext, type TestFn, type TestOptions } from './test.ts'

/**
 * Makes a new folder with `files` in it and returns its path:
 * `.ubq/testdir/<test file>/<test name>`. The folder is removed
 * when the test ends. If the test fails, the folder stays.
 *
 * ```ts
 * const dir = testdir({ 'package.json': '{}', src: { 'a.ts': 'export {}' } })
 * assert.deepEqual(list(dir), ['package.json', 'src/a.ts'])
 * ```
 */
export const testdir = (files?: Files): string => makeTestdir(currentFile(), files)

// For a plain program. A test process of the runner did this in its
// preload, before the source loaded.
setDefines()
// A child of the runner sends its events to the runner. Any other
// process has the runner role for itself.
if (process.env.UBQ_CHILD) startPipe()
else startPlain()
// `ubq` shows output only for a test that failed. A plain program
// keeps its console, so that it is easy to debug.
if (process.env.UBQ_CAPTURE) startCapture(currentFile)
// Processes that the tests start must not get these.
setUpdate(!!process.env.UBQ_UPDATE)
for (const name of [
  'UBQ_CHILD',
  'UBQ_FILE',
  'UBQ_LINES',
  'UBQ_IDS',
  'UBQ_COMMAND',
  'UBQ_CAPTURE',
  'UBQ_UPDATE',
  'UBQ_HANG',
  'UBQ_MUTANT',
  'UBQ_LIMIT',
  'UBQ_EVENTS',
])
  delete process.env[name]
setCollector(startCoverage())
