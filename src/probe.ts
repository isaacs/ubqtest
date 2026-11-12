// Reads the stack of a process that is in a loop that does not
// return. The inspector can pause such a process, because it
// interrupts the JavaScript engine.
import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Location } from './events.ts'

/** Time after the limit of a test before a watchdog acts. */
export const GRACE_MS = 2000
/** The longest time to wait for a stack. */
export const PROBE_MS = 1500

/**
 * The user code frames of the process whose inspector is at `url`,
 * innermost first. Empty if the process is not `pid`, or on an error.
 * Paths are relative to `root`.
 */
export const pausedStack = (url: string, pid: number, root: string): Promise<Location[]> =>
  new Promise(resolve => {
    setTimeout(resolve, PROBE_MS, []).unref()
    const ws = new WebSocket(url)
    const frames: Location[] = []
    const urls = new Map<string, string>()
    ws.onerror = () => resolve([])
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Debugger.enable' }))
      ws.send(JSON.stringify({ id: 2, method: 'Debugger.pause' }))
    }
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data as string)
      // A call frame has the ID of its script, not the URL.
      if (m.method === 'Debugger.scriptParsed') urls.set(m.params.scriptId, m.params.url)
      else if (m.method === 'Debugger.paused') {
        for (const f of m.params.callFrames as {
          location: { scriptId: string; lineNumber: number; columnNumber: number }
        }[]) {
          const script = urls.get(f.location.scriptId)
          if (!script?.startsWith('file:')) continue
          const path = fileURLToPath(script)
          if (path.includes(`${sep}node_modules${sep}`) || path.startsWith(import.meta.dirname + sep))
            continue
          frames.push({
            file: relative(root, path).split(sep).join('/'),
            line: f.location.lineNumber + 1,
            column: f.location.columnNumber + 1,
          })
        }
        // The inspector port can belong to a different process.
        ws.send(
          JSON.stringify({
            id: 3,
            method: 'Debugger.evaluateOnCallFrame',
            params: { callFrameId: m.params.callFrames[0].callFrameId, expression: 'process.pid' },
          }),
        )
      } else if (m.id === 3) {
        resolve(m.result?.result?.value === pid ? frames.slice(0, 6) : [])
        ws.close()
      }
    }
  })

/**
 * Starts the inspector of a Node process on Windows, which has no
 * SIGUSR1. Does nothing on a runtime that does not have the function.
 */
export const debugProcess = (pid: number): void => {
  try {
    ;(process as { _debugProcess?: (pid: number) => void })._debugProcess?.(pid)
  } catch {
    // The process ended, or it is not a Node process.
  }
}

/** The message of the failure for a test that is in such a loop. */
export const stuckMessage = (timeout: number): string =>
  `the test did not end in ${timeout} ms, and the process does not respond. The code is in a loop that does not return.`

export const STOPPED = 'ubq stopped the process. The tests after the stuck test did not run.'
