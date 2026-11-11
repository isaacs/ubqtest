// Does a sync write to fd 3 work when fd 3 is a pipe from a parent?
import { spawn } from 'node:child_process'
for (const [cmd, ...args] of [['node'], ['deno', 'run', '-A'], ['bun']]) {
  const p = spawn(cmd, [...args, 'fd3-child.mjs'], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] })
  let got = '', err = ''; p.stdio[3].on('data', d => got += d); p.stderr.on('data', d => err += d)
  await new Promise(r => p.on('close', r))
  console.log(cmd.padEnd(5), got.trim() || 'NO: ' + err.trim().split('\n')[0].slice(0, 90))
}
