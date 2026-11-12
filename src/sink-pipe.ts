// The pipe sink: a test process that the runner started writes its
// events as JSON lines to file descriptor 3.
// See docs/04-architecture.md, section 3.
import { subscribe } from 'node:diagnostics_channel'
import { openSync, writeSync } from 'node:fs'
import { CHANNEL } from './emit.ts'

export const startPipe = (): void => {
  // Deno has its own numbers for open files. The path gives the
  // descriptor that the process got from the runner.
  let fd = 3
  let closed = false
  try {
    if (process.versions.deno) fd = openSync('/dev/fd/3', 'w')
  } catch {
    // The process has no pipe to a runner (a hang rerun on Deno).
    closed = true
  }
  subscribe(CHANNEL, event => {
    if (closed) return
    try {
      // A sync write: an event must not be lost if the process dies.
      writeSync(fd, JSON.stringify(event) + '\n')
    } catch {
      // The runner went away. More writes cannot work.
      closed = true
    }
  })
}
