// Starts coverage before any user module loads:
//   node --import ubqtest/preload test/foo.ts
// The runner starts each test process this way.
import { setDefines } from './config.ts'
import { startCoverage } from './coverage.ts'

startCoverage(true)
setDefines()
