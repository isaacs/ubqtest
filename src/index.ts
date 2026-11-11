// The public API. See docs/05-api.md.
import { startCapture } from './capture.ts'
import { startCoverage } from './coverage.ts'
import { startPlain } from './plain.ts'
import { startPipe } from './sink-pipe.ts'
import { currentFile, setCollector } from './test.ts'

export { assert, type Assert, type Pattern } from './assert.ts'
export {
  describe,
  test,
  type TestContext,
  type TestFn,
  type TestOptions,
} from './test.ts'

// A child of the runner sends its events to the runner. Any other
// process has the runner role for itself.
if (process.env.UBQ_CHILD) startPipe()
else startPlain()
// `ubq` shows output only for a test that failed. A plain program
// keeps its console, so that it is easy to debug.
if (process.env.UBQ_CAPTURE) startCapture(currentFile)
// Processes that the tests start must not get these.
for (const name of ['UBQ_CHILD', 'UBQ_FILE', 'UBQ_LINES', 'UBQ_COMMAND', 'UBQ_CAPTURE'])
  delete process.env[name]
setCollector(startCoverage())
