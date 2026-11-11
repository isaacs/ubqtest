import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { assert, test } from 'ubqtest'

test('starts a process and does not stop it', () => {
  const child = spawn('sleep', ['30'], { stdio: 'ignore' })
  child.unref()
  writeFileSync(process.env.ORPHAN_PID_FILE!, String(child.pid))
  assert(child.pid)
})
