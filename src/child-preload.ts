// The module that each process below a test process loads, from
// the options of Node or Bun in its environment (D53). It counts
// which code of the project runs, and writes the counts for the
// test process. It changes nothing else in the process.
import { patchSpawn, startChild } from './child-coverage.ts'

if (process.env.UBQ_CHILD_COVERAGE) {
  startChild()
  patchSpawn()
}
