// The public API. See docs/05-api.md.
import { startCoverage } from './coverage.ts'
import { startPlain } from './plain.ts'
import { startPipe } from './sink-pipe.ts'
import { setCollector } from './test.ts'

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
// Processes that the tests start must not get these.
for (const name of ['UBQ_CHILD', 'UBQ_FILE', 'UBQ_LINES', 'UBQ_COMMAND'])
  delete process.env[name]
setCollector(startCoverage())
