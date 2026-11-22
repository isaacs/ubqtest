// The slots that the runs of the workspaces share (D140).
import { connect } from 'node:net'
import { assert, cleanup, test } from 'ubqtest'
import { serveSlots } from '../src/slots.ts'

/** A run of a workspace: the count of slots that it got. */
const client = async (port: number) => {
  const socket = connect(port, '127.0.0.1')
  await new Promise(resolve => socket.on('connect', resolve))
  let got = 0
  socket.on('data', (data: Buffer) => (got += data.length))
  return { socket, got: () => got }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 50))

test('a run that ends gives back its slots, and its waits go away', async () => {
  const slots = await serveSlots(1)
  cleanup(() => slots.close())
  const a = await client(slots.port)
  const b = await client(slots.port)
  cleanup(() => void b.socket.destroy())
  // a takes the one slot, and waits for two more.
  a.socket.write('ttt')
  await tick()
  assert.equal(a.got(), 1)
  b.socket.write('t')
  await tick()
  assert.equal(b.got(), 0)
  // a ends: its slot goes to b, and its waits do not get one.
  a.socket.destroy()
  await tick()
  assert.equal(b.got(), 1)
  b.socket.write('gt')
  await tick()
  assert.equal(b.got(), 2)
})
