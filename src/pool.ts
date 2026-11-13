// The client side of the background server: a runner asks the
// server for a test process that is already started.
// See docs/11-server.md.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import type { Socket } from 'node:net'
import { join, relative } from 'node:path'
import type { Readable } from 'node:stream'
import { projectRoot } from './project.ts'

/** The socket of the server of this project. */
export const socketPath = (): string => join(projectRoot(), '.ubq', 'server.sock')

/**
 * The socket as a path from the working directory. A socket path has
 * a limit of about 100 characters, and a relative path is short.
 * Undefined if it is too long also in that form.
 */
export const socketAddress = (): string | undefined => {
  // Windows has no socket file. The server has a named pipe there,
  // and the file at `socketPath` only tells that a server started.
  if (process.platform === 'win32')
    return `\\\\.\\pipe\\ubq-${createHash('sha1').update(projectRoot()).digest('hex').slice(0, 16)}`
  const path = relative(process.cwd(), socketPath())
  return path.length < 100 ? path : undefined
}

/**
 * Changes when the runtime or the code of ubq changes. A server
 * with a different stamp has processes that loaded old code.
 */
export const stamp = (): string => {
  if (stamped) return stamped
  const dir = import.meta.dirname
  let newest = 0
  for (const name of readdirSync(dir)) newest = Math.max(newest, statSync(join(dir, name)).mtimeMs)
  const v = process.versions
  return (stamped = [process.execPath, v.bun ?? v.deno ?? v.node, dir, newest].join(' '))
}
let stamped: string | undefined

export type Request =
  | { type: 'status' | 'stop' }
  | {
      type: 'run'
      stamp: string
      /** The test file, as an absolute path. */
      file: string
      /** The environment of the runner. The process that the server has must have started with the same one. */
      base: Record<string, string | undefined>
      /** The variables that the runner adds for this test process. */
      job: Record<string, string>
    }

/** A frame from the server: one tag character, the length, the data. */
export const frame = (tag: string, data: Buffer | string): Buffer => {
  const body = typeof data === 'string' ? Buffer.from(data) : data
  const head = Buffer.alloc(5)
  head.write(tag, 0, 'latin1')
  head.writeUInt32BE(body.length, 1)
  return Buffer.concat([head, body])
}

/** Calls `each` for each complete frame that arrives on `socket`. */
export const frames = (socket: Socket, each: (tag: string, data: Buffer) => void): void => {
  let buffer: Buffer = Buffer.alloc(0)
  socket.on('data', (chunk: Buffer) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk
    while (buffer.length >= 5) {
      const length = buffer.readUInt32BE(1)
      if (buffer.length < 5 + length) break
      each(String.fromCharCode(buffer[0]!), buffer.subarray(5, 5 + length))
      buffer = buffer.subarray(5 + length)
    }
  })
}

/** Connects to the server. Undefined if the project has no server that answers. */
export const dial = (): Promise<Socket | undefined> =>
  new Promise(done => {
    const address = socketAddress()
    if (!address || !existsSync(socketPath())) return done(undefined)
    // Not an import: a run with no server must not pay for the load
    // of `node:net`.
    const socket = process.getBuiltinModule('node:net').connect(address)
    socket.once('connect', () => done(socket))
    // A socket file with no server: the server died.
    socket.once('error', () => done(undefined))
  })

/** The part of a child process that the runner uses. */
export interface TestProcess {
  pid?: number | undefined
  stdout: Readable | null
  stderr: Readable | null
  stdio: (unknown | null)[]
  kill(signal: NodeJS.Signals): boolean
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
}

/**
 * A test process from the server, with the streams of a child
 * process. Undefined if the server has none for this request: the
 * runner then starts the process itself.
 */
export const warmProcess = async (
  job: Omit<Request & { type: 'run' }, 'type' | 'stamp'>,
): Promise<TestProcess | undefined> => {
  const socket = await dial()
  if (!socket) return undefined
  const { PassThrough } = process.getBuiltinModule('node:stream')
  const { EventEmitter } = process.getBuiltinModule('node:events')
  return new Promise(done => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const events = new PassThrough()
    const emitter = new EventEmitter()
    let pid: number | undefined
    let answered = false
    const none = (): void => {
      if (answered) return
      answered = true
      socket.destroy()
      done(undefined)
    }
    socket.on('error', none)
    socket.on('close', () => {
      none()
      // The server went away before the process ended.
      if (!exited) exit(null, 'SIGKILL')
    })
    let exited = false
    const exit = (code: number | null, signal: NodeJS.Signals | null): void => {
      exited = true
      let open = 3
      // As for a child process: `close` comes after the last data.
      for (const stream of [stdout, stderr, events]) {
        stream.on('end', () => --open || emitter.emit('close', code, signal))
        stream.end()
      }
    }
    frames(socket, (tag, data) => {
      if (tag === 'n') none()
      else if (tag === 'i') {
        pid = +data.toString()
        answered = true
        done({
          pid,
          stdout,
          stderr,
          stdio: [null, stdout, stderr, events],
          // ubq: not measured: no test calls kill() of this process
          kill: signal => process.kill(pid!, signal),
          on: (event, listener) => emitter.on(event, listener),
        })
      } else if (tag === 'o') stdout.write(data)
      else if (tag === 'e') stderr.write(data)
      else if (tag === 'p') events.write(data)
      else if (tag === 'x') {
        const { code, signal } = JSON.parse(data.toString()) as { code: number | null; signal: NodeJS.Signals | null }
        exit(code, signal)
      }
    })
    socket.write(JSON.stringify({ type: 'run', stamp: stamp(), ...job } satisfies Request) + '\n')
  })
}
