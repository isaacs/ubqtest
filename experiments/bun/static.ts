import './plugin-only.ts'
import { pick } from './src.ts'
pick(0, null)
console.log('static import instrumented:', [...(globalThis as any).__cov.values()][0]?.[0] === 1)
