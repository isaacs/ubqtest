// Starts coverage before any user module loads:
//   node --import ubqtest/preload test/foo.ts
// The runner starts each test process this way.
import { setDefines } from './config.ts'
import { startCoverage } from './coverage.ts'
import { setDom } from './dom.ts'

startCoverage(true)
setDefines()
setDom(process.env.UBQ_FILE)
