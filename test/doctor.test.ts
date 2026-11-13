// `ubq doctor` and `ubq guide`.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { project } from './setup.ts'

test('doctor states the fix for each problem of the setup', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  const doctor = () => {
    const r = p.ubq('doctor')
    return { code: r.code, lines: r.out.trimEnd().split('\n').slice(2) }
  }
  // The fixture files have names that are not test file names.
  const none = doctor()
  assert.equal(none.code, 1)
  assert.match(none.lines[1]!, /^FIX  no test files\. The name of a test file must end in \.test\.ts/)
  assert.match(none.lines[2]!, /^FIX  9 files have tests, and "ubq" with no arguments does not run them: fail\.ts, fix\.ts, flip\.ts, leak\.ts, load-error\.ts, and 4 more\. Give each one/)
  assert.equal(none.lines.at(-1), 'doctor: 2 problems')

  p.configure({ include: ['*.ts'] })
  assert.deepEqual(doctor(), {
    code: 0,
    lines: ["ok   import from 'ubqtest' works in this project", 'ok   10 test files', 'doctor: 0 problems'],
  })

  p.configure({ include: ['*.ts'], retries: 2 })
  assert.equal(doctor().lines[1], 'FIX  unknown key "retries" in "ubq" in package.json. The keys are: include, exclude, timeout, hangRerun, bunInspectorCoverage, browser, workers')

  p.configure({ include: ['*.ts'] })
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ // comment\n  "compilerOptions": { "strict": true, "erasableSyntaxOnly": true, },\n}')
  assert.match(doctor().lines[2]!, /^FIX  tsconfig\.json: set "allowImportingTsExtensions": true in compilerOptions\./)
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ "compilerOptions": { "allowImportingTsExtensions": true, "erasableSyntaxOnly": true } }')
  assert.deepEqual(doctor().lines.slice(2), ['ok   tsconfig.json', 'doctor: 0 problems'])

  writeFileSync(join(p.dir, 'worker.ts'), "import { env } from 'cloudflare:test'\n")
  assert.match(doctor().lines[2]!, /^FIX  this project has tests of a Cloudflare Worker .* Add to package\.json: "ubq": \{ "workers": /)
  p.configure({ include: ['*.ts'], workers: [{ config: 'wrangler.jsonc', include: ['worker.ts'] }] })
  assert.equal(doctor().lines[2], 'FIX  "ubq.workers" in package.json names a wrangler config that does not exist: wrangler.jsonc')
  writeFileSync(join(p.dir, 'wrangler.jsonc'), '{}')
  assert.match(doctor().lines[2]!, /^FIX  "ubq\.workers" is set, and the project does not have wrangler\..* Run: npm install --save-dev wrangler$/)
})

test('guide prints the guide of the package', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  assert.equal(p.ubq('guide').out, readFileSync(new URL('../GUIDE.md', import.meta.url), 'utf8'))
})

test('skill writes to the skill folders of the project and to the folder of the agent', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
  // The agent that runs this test can set these variables.
  const env = { ...process.env }
  for (const name of ['CLAUDECODE', 'CLAUDE_CODE', 'CURSOR_AGENT', 'GEMINI_CLI', 'ANTIGRAVITY_AGENT', 'COPILOT_AGENT', 'COPILOT_CLI', 'CODEX_THREAD_ID', 'CODEX_SANDBOX', 'AI_AGENT'])
    delete env[name]
  const skill = (more: Record<string, string> = {}, ...args: string[]) =>
    spawnSync('node', [cli, 'skill', ...args], { cwd: p.dir, encoding: 'utf8', env: { ...env, ...more } }).stdout.trimEnd().split('\n')
  assert.deepEqual(skill(), ['wrote .claude/skills/use-ubq/SKILL.md'])
  rmSync(join(p.dir, '.claude'), { recursive: true })
  assert.deepEqual(skill({ GEMINI_CLI: '1' }), ['wrote .gemini/skills/use-ubq/SKILL.md'])
  mkdirSync(join(p.dir, '.cursor/skills'), { recursive: true })
  assert.deepEqual(skill({ CODEX_SANDBOX: 'seatbelt' }), [
    'wrote .agents/skills/use-ubq/SKILL.md',
    'wrote .cursor/skills/use-ubq/SKILL.md',
    'wrote .gemini/skills/use-ubq/SKILL.md',
  ])
  assert(!existsSync(join(p.dir, '.claude')))
  // A named agent or folder is the only place.
  assert.deepEqual(skill({ GEMINI_CLI: '1' }, 'copilot', '.mine/skills'), [
    'wrote .github/skills/use-ubq/SKILL.md',
    'wrote .mine/skills/use-ubq/SKILL.md',
  ])
  assert.equal(
    readFileSync(join(p.dir, '.agents/skills/use-ubq/SKILL.md'), 'utf8'),
    readFileSync(new URL('../skills/use-ubq/SKILL.md', import.meta.url), 'utf8'),
  )
})
