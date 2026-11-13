// A trial of coverage for a child process with source counters:
// NODE_OPTIONS="--import <this file>". The counters of the project
// start, and the process writes its counts to a file when it exits.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import '../../src/counters-preload.ts'

const dir = process.env.UBQ_CHILD_DIR
if (dir)
  process.on('exit', () => {
    const counters = (globalThis as Record<symbol, unknown>)[Symbol.for('ubqtest.counters')] as Map<string, Uint32Array>
    const files: Record<string, number[]> = {}
    for (const [file, counts] of counters) if (counts.some(Boolean)) files[file] = [...counts]
    writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify(files))
  })
