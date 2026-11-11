// The pipe sink: a test process that the runner started writes its
// events as JSON lines to file descriptor 3.
// See docs/04-architecture.md, section 3.
import { subscribe } from 'node:diagnostics_channel'
import { writeSync } from 'node:fs'
import { CHANNEL } from './emit.ts'

export const startPipe = (): void => {
  let closed = false
  subscribe(CHANNEL, event => {
    if (closed) return
    try {
      // A sync write: an event must not be lost if the process dies.
      writeSync(3, JSON.stringify(event) + '\n')
    } catch {
      // The runner went away. More writes cannot work.
      closed = true
    }
  })
}
