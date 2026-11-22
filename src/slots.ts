// The slots of the CPU that the runs of the workspaces of a monorepo
// share (D140). The root `ubq` holds them, and starts the run of each
// workspace at the same time. A run in a workspace takes a slot
// before each test file, and gives it back when the file ends. So
// the count of test processes is the count of one run, and a slot
// that a short run gives back goes to a longer run.
//
// The protocol is one byte for each message on a local TCP socket:
// `t` takes a slot, `g` gives one back, and the root answers `t`
// with `\n` when the slot is free. A run that ends gives back its
// slots when its socket closes.
import { connect, createServer, type Socket } from 'node:net'

export interface Slots {
  /** Waits for a free slot. */
  take(): Promise<void>
  give(): void
}

/**
 * Starts the slots of the root run. Its port is the value of
 * `UBQ_SLOTS` for the run of each workspace.
 */
export const serveSlots = async (count: number): Promise<{ port: number; close(): void }> => {
  let free = count
  const held = new Map<Socket, number>()
  const waiting: Socket[] = []
  const grant = (): void => {
    while (free > 0 && waiting.length) {
      const next = waiting.shift()!
      free--
      held.set(next, held.get(next)! + 1)
      next.write('\n')
    }
  }
  const server = createServer(socket => {
    held.set(socket, 0)
    // ubq: not measured: a local socket gives no error in the tests
    socket.on('error', () => {})
    socket.on('data', (data: Buffer) => {
      for (const byte of data.toString('latin1'))
        if (byte === 't') waiting.push(socket)
        else if (byte === 'g') {
          held.set(socket, held.get(socket)! - 1)
          free++
        }
      grant()
    })
    socket.on('close', () => {
      free += held.get(socket)!
      held.delete(socket)
      for (let at = waiting.indexOf(socket); at >= 0; at = waiting.indexOf(socket)) waiting.splice(at, 1)
      grant()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { port: (server.address() as { port: number }).port, close: () => server.close() }
}

/**
 * The slots of the root run, for the run of a workspace. Undefined
 * in a usual run. It reads `UBQ_SLOTS` one time, and removes it from
 * the environment: a test process must not get it.
 */
export const rootSlots = (): Slots | undefined => {
  const port = process.env.UBQ_SLOTS
  delete process.env.UBQ_SLOTS
  if (!port) return undefined
  const socket = connect(+port, '127.0.0.1')
  const waiters: (() => void)[] = []
  // The socket keeps the process alive only while a take waits.
  const refs = (): void => void (waiters.length ? socket.ref() : socket.unref())
  socket.on('data', (data: Buffer) => {
    for (let i = 0; i < data.length; i++) waiters.shift()?.()
    refs()
  })
  // ubq: not measured: the root run ends after the runs of its workspaces
  socket.on('error', () => {
    // With no root, the run goes on with no limit.
    for (const waiter of waiters.splice(0)) waiter()
  })
  refs()
  return {
    take: () =>
      new Promise<void>(resolve => {
        waiters.push(resolve)
        refs()
        socket.write('t')
      }),
    give: () => void socket.write('g'),
  }
}
