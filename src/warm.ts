// A test process that the background server starts before a runner
// needs it. The coverage preload ran. The process waits here, in a
// read of stdin, for its test file and its environment.
import { readSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const chunks: Buffer[] = []
const buffer = Buffer.alloc(65536)
// The server writes the job and closes the pipe.
const read = (): number => {
  try {
    return readSync(0, buffer)
  } catch (error) {
    // On Windows, the end of a pipe is an error.
    if ((error as NodeJS.ErrnoException).code === 'EOF') return 0
    throw error
  }
}
for (let n = read(); n > 0; n = read()) chunks.push(Buffer.from(buffer.subarray(0, n)))
const text = Buffer.concat(chunks).toString()
// No job: the server went away.
if (!text) process.exit(0)
const job = JSON.parse(text) as { file: string; env: Record<string, string> }
// The environment of the runner, as a process that the runner
// starts has it.
for (const name of Object.keys(process.env)) if (!(name in job.env)) delete process.env[name]
Object.assign(process.env, job.env)
process.argv[1] = job.file
await import(pathToFileURL(job.file).href)
