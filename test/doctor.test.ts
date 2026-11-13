// `ubq doctor` and `ubq guide`.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

  p.configure({ include: ['empty.ts', 'fail.ts', 'fix.ts', 'flip.ts', 'leak.ts', 'load-error.ts'] })
  assert.match(doctor().lines[2]!, /^FIX  4 files have tests, and "ubq" with no arguments does not run them: mock\.ts, pass\.ts, snap\.ts, sometimes\.ts\. Give each one/)

  p.configure({ include: ['*.ts'], retries: 2 })
  assert.equal(doctor().lines[1], 'FIX  unknown key "retries" in "ubq" in package.json. The keys are: include, exclude, helpers, build, timeout, hangRerun, bunInspectorCoverage, browser, workers')

  p.configure({ include: ['*.ts'] })
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ // comment\n  "compilerOptions": { "strict": true, "erasableSyntaxOnly": true, },\n}')
  assert.match(doctor().lines[2]!, /^FIX  tsconfig\.json: set "allowImportingTsExtensions": true in compilerOptions\./)
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ "compilerOptions": { "allowImportingTsExtensions": true, "erasableSyntaxOnly": true } }')
  assert.deepEqual(doctor().lines.slice(2), ['ok   tsconfig.json', 'doctor: 0 problems'])

  writeFileSync(join(p.dir, 'worker.ts'), "import { env } from 'cloudflare:test'\n")
  // With no vitest config: one entry for each wrangler config, as JSON on its own lines.
  assert.match(doctor().lines[2]!, /^FIX  this project has tests of a Cloudflare Worker .* Add to "ubq" in package\.json, and check /)
  assert.deepEqual(JSON.parse(doctor().lines.slice(3, -2).join('\n')), { workers: [{ config: 'wrangler.jsonc', include: ['**/*.test.ts'] }] })
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

test('doctor: a folder with no package.json, a browser test, a Workers project, and tsconfig files', { timeout: 60_000 }, () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
  const doctor = (cmd = 'node', ...args: string[]): string[] =>
    spawnSync(cmd, [...args, cli, 'doctor'], { cwd: p.dir, encoding: 'utf8', env: { ...process.env, CI: '' } }).stdout.trimEnd().split('\n')
  const find = (lines: string[], start: string): string | undefined => lines.find(line => line.startsWith(start))

  // A test file for a browser, and the project has no driver.
  writeFileSync(join(p.dir, 'page.test.ts'), "import { test } from 'ubqtest'\nimport { browser } from 'ubqtest/browser'\ntest('a', async () => void (await browser()))\n")
  assert.equal(
    find(doctor(), 'FIX  a test file imports'),
    "FIX  a test file imports 'ubqtest/browser', and the project does not have playwright-core. Run: npm install --save-dev playwright-core, then: npx ubq browser install",
  )
  rmSync(join(p.dir, 'page.test.ts'))

  // More than one wrangler config, and no vitest config: one entry for each, a folder first.
  mkdirSync(join(p.dir, 'api'))
  writeFileSync(join(p.dir, 'wrangler.jsonc'), '{}')
  writeFileSync(join(p.dir, 'api/wrangler.toml'), '')
  writeFileSync(join(p.dir, 'w.test.ts'), "import { env } from 'cloudflare:workers'\nimport { test } from 'ubqtest'\ntest('a', () => void env)\n")
  const lines = doctor()
  const at = lines.findIndex(line => line.startsWith('FIX  this project has tests of a Cloudflare Worker'))
  assert.deepEqual(JSON.parse(lines.slice(at + 1, lines.indexOf('}', at) + 1).join('\n')), {
    workers: [
      { config: 'api/wrangler.toml', include: ['api/**/*.test.ts'] },
      { config: 'wrangler.jsonc', include: ['**/*.test.ts'] },
    ],
  })
  // The key is set, and the project has wrangler.
  p.configure({ workers: [{ config: 'wrangler.jsonc', include: ['w.test.ts'] }] })
  symlinkSync(fileURLToPath(new URL('../node_modules/wrangler', import.meta.url)), join(p.dir, 'node_modules/wrangler'), 'junction')
  assert.equal(find(doctor(), 'ok   wrangler'), 'ok   wrangler, for tests in the Workers runtime')

  // A tsconfig that the check cannot read, one that extends a second one, and one with no options.
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ not json')
  assert.equal(find(doctor(), 'FIX  tsconfig'), undefined)
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ "extends": "./base.json" }')
  assert.deepEqual([find(doctor(), 'FIX  tsconfig'), find(doctor(), 'ok   tsconfig')], [undefined, undefined])
  // No test file imports with the .ts extension: one option is necessary.
  writeFileSync(join(p.dir, 'tsconfig.json'), '{}')
  assert.equal(
    find(doctor(), 'FIX  tsconfig'),
    'FIX  tsconfig.json: set "erasableSyntaxOnly": true in compilerOptions. The runtime runs only TypeScript syntax that it can erase (no enum, no namespace, no parameter properties).',
  )

  // The project cannot import ubqtest. The link is a junction on Windows.
  const link = join(p.dir, 'node_modules/ubqtest')
  if (process.platform === 'win32') rmdirSync(link)
  else rmSync(link)
  assert.equal(find(doctor(), 'FIX  the project cannot'), "FIX  the project cannot import 'ubqtest'. Run: npm install --save-dev ubqtest")
  // No package.json at or above the folder.
  rmSync(join(p.dir, 'package.json'))
  assert.equal(
    find(doctor(), 'FIX  no package.json'),
    `FIX  no package.json at or above ${p.dir}. The folder of package.json is the project. Run: npm init -y`,
  )
})

for (const [cmd, name, ...args] of [['bun', 'Bun'], ['deno', 'Deno', 'run', '-A']] as const)
  test(`doctor names the runtime: ${name}`, { skip: spawnSync(cmd, ['--version']).status !== 0 && `${cmd} is not installed` }, () => {
    const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
    const first = spawnSync(cmd, [...args, cli, 'doctor'], { cwd: fileURLToPath(new URL('./fixtures/cov/', import.meta.url)), encoding: 'utf8' }).stdout.split('\n')[0]!
    assert.match(first, new RegExp(`^ok   ${name} \\d+\\.\\d+`))
  })
