// The frames of the socket of the server: a frame can come in more
// than one chunk, and one chunk can have more than one frame.
import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'
import { assert, test } from 'ubqtest'
import { frame, frames } from '../src/pool.ts'

test('frames in parts, and two frames in one chunk', () => {
  const socket = new EventEmitter()
  const got: [string, string][] = []
  frames(socket as Socket, (tag, data) => got.push([tag, data.toString()]))
  const one = frame('o', 'hello')
  socket.emit('data', one.subarray(0, 3))
  socket.emit('data', one.subarray(3, 7))
  socket.emit('data', Buffer.concat([one.subarray(7), frame('x', '{}')]))
  assert.deepEqual(got, [['o', 'hello'], ['x', '{}']])
})
