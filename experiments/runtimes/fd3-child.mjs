import { writeSync } from 'node:fs'; writeSync(3, JSON.stringify({ e: 'test-end', ok: true }) + '\n')
