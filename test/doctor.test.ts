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
  assert.match(
    none.lines[2]!,
    /^FIX  9 files have tests, and "ubq" with no arguments does not run them: fail\.ts, fix\.ts, flip\.ts, leak\.ts, load-error\.ts, and 4 more\. Give each one/,
  )
  assert.equal(none.lines.at(-1), 'doctor: 2 problems')

  p.configure({ include: ['*.ts'] })
  assert.deepEqual(doctor(), {
    code: 0,
    lines: ["ok   import from 'ubqtest' works in this project", 'ok   10 test files', 'doctor: 0 problems'],
  })

  p.configure({ include: ['empty.ts', 'fail.ts', 'fix.ts', 'flip.ts', 'leak.ts', 'load-error.ts'] })
  assert.match(
    doctor().lines[2]!,
    /^FIX  4 files have tests, and "ubq" with no arguments does not run them: mock\.ts, pass\.ts, snap\.ts, sometimes\.ts\. Give each one/,
  )

  p.configure({ include: ['*.ts'], retries: 2 })
  assert.equal(
    doctor().lines[1],
    'FIX  unknown key "retries" in "ubq" in package.json. The keys are: include, exclude, helpers, build, timeout, hangRerun, bunInspectorCoverage, browser, workers, define, transform',
  )

  p.configure({ include: ['*.ts'] })
  // Files with no import, such as the snapshot files of tap.
  const names = ['s1', 's2', 's3', 's4', 's5', 's6'].map(name => `${name}.ts`)
  for (const name of names) writeFileSync(join(p.dir, name), 'exports[`a`] = 1\n')
  assert.equal(
    doctor().lines[2],
    'FIX  6 test files do not import ubqtest: s1.ts, s2.ts, s3.ts, s4.ts, s5.ts, and 1 more. Convert each test file: ubq convert <file>. Remove each file that is not a test file, or add it to "ubq": { "exclude": [...] } in package.json.',
  )
  for (const name of names) rmSync(join(p.dir, name))
  writeFileSync(
    join(p.dir, 'tsconfig.json'),
    '{ // comment\n  "compilerOptions": { "strict": true, "erasableSyntaxOnly": true, },\n}',
  )
  // A tsconfig that makes JavaScript files also needs the option
  // that changes the extension of an import.
  assert.match(
    doctor().lines[2]!,
    /^FIX  tsconfig\.json: set "allowImportingTsExtensions": true and "rewriteRelativeImportExtensions": true in compilerOptions\. .* tsc then changes the \.ts extension of an import to \.js\./,
  )
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ "compilerOptions": { "noEmit": true, "erasableSyntaxOnly": true } }')
  assert.match(doctor().lines[2]!, /^FIX  tsconfig\.json: set "allowImportingTsExtensions": true in compilerOptions\./)
  writeFileSync(
    join(p.dir, 'tsconfig.json'),
    '{ "compilerOptions": { "allowImportingTsExtensions": true, "erasableSyntaxOnly": true, "rewriteRelativeImportExtensions": true } }',
  )
  assert.deepEqual(doctor().lines.slice(2), ['ok   tsconfig.json', 'doctor: 0 problems'])
  // Syntax that Node cannot run. The project then needs Bun, and
  // its tsconfig does not need the option that refuses the syntax.
  const hard = ['hard', 'h2', 'h3', 'h4', 'h5', 'h6'].map(name => `src/${name}.ts`)
  for (const file of hard) writeFileSync(join(p.dir, file), 'export enum E {\n  A,\n}\n')
  // A decorator, with a doc comment that is not one.
  writeFileSync(
    join(p.dir, 'src/h6.ts'),
    '/**\n * @param x\n */\n@Injectable()\nexport class S {\n  @Inject(T) t = 1\n}\n',
  )
  writeFileSync(join(p.dir, 'src/doc.ts'), '/**\n * @param x a value\n */\nexport const f = (x: number): number => x\n')
  p.configure({ include: ['*.ts'], build: hard.slice(1) })
  writeFileSync(join(p.dir, 'src/types.d.ts'), 'export enum D {\n  A,\n}\n')
  const full = readFileSync(join(p.dir, 'tsconfig.json'), 'utf8')
  writeFileSync(
    join(p.dir, 'tsconfig.json'),
    '{ "compilerOptions": { "noEmit": true, "allowImportingTsExtensions": true } }',
  )
  assert.deepEqual(
    doctor()
      .lines.slice(2)
      .map(line =>
        line.replace(
          /(Do not choose for the person who owns the project\.) Ask them to choose one of three\. .*$/,
          '$1',
        ),
      ),
    [
      'FIX  1 files have TypeScript syntax that Node cannot run (enum, namespace, a parameter property, or a decorator): src/hard.ts. Node runs only syntax that it can erase. Do not choose for the person who owns the project.',
      'ok   tsconfig.json',
      'doctor: 1 problems',
    ],
  )
  // A build tool is not code that a test loads.
  p.configure({ include: ['*.ts'], build: hard })
  assert.match(doctor().lines[2]!, /^FIX  tsconfig\.json: set "erasableSyntaxOnly": true in compilerOptions\./)
  p.configure({ include: ['*.ts'] })
  assert.match(
    doctor().lines[2]!,
    /^FIX  6 files have TypeScript syntax that Node cannot run \(enum, namespace, a parameter property, or a decorator\): src\/h2\.ts, src\/h3\.ts, src\/h4\.ts, src\/h5\.ts, src\/h6\.ts, and 1 more\. /,
  )
  // The files with such syntax that a test imports, also through a
  // file with no such syntax.
  writeFileSync(join(p.dir, 'src/mid.ts'), "export * from './h2.js'\nexport * from './h3'\n")
  writeFileSync(join(p.dir, 'uses.test.ts'), "import './src/mid.ts'\n")
  assert.match(
    doctor().lines.find(line => line.includes('files have TypeScript syntax'))!,
    /and 1 more\. The tests import 2 of them: src\/h2\.ts, src\/h3\.ts\. No test imports the others now\. Node runs only/,
  )
  rmSync(join(p.dir, 'uses.test.ts'))
  rmSync(join(p.dir, 'src/mid.ts'))
  for (const file of hard) rmSync(join(p.dir, file))
  rmSync(join(p.dir, 'src/types.d.ts'))
  writeFileSync(join(p.dir, 'tsconfig.json'), full)

  writeFileSync(join(p.dir, 'worker.ts'), "import { env } from 'cloudflare:test'\n")
  // The file still imports the old tool.
  assert.match(doctor().lines[2]!, /^FIX  1 test files do not import ubqtest: worker\.ts\. Convert each test file/)
  writeFileSync(join(p.dir, 'worker.ts'), "import { env } from 'cloudflare:workers'\n")
  // With no vitest config: one entry for each wrangler config, as JSON on its own lines.
  assert.match(
    doctor().lines[2]!,
    /^FIX  this project has tests of a Cloudflare Worker .* Add to "ubq" in package\.json, and check /,
  )
  assert.deepEqual(JSON.parse(doctor().lines.slice(3, -2).join('\n')), {
    workers: [{ config: 'wrangler.jsonc', include: ['**/*.test.ts'] }],
  })
  p.configure({ include: ['*.ts'], workers: [{ config: 'wrangler.jsonc', include: ['worker.ts'] }] })
  assert.equal(
    doctor().lines[2],
    'FIX  "ubq.workers" in package.json names a wrangler config that does not exist: wrangler.jsonc',
  )
  writeFileSync(join(p.dir, 'wrangler.jsonc'), '{}')
  assert.match(
    doctor().lines[2]!,
    /^FIX  "ubq\.workers" is set, and the project does not have wrangler\..* Run: npm install --save-dev wrangler$/,
  )
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
  for (const name of [
    'CLAUDECODE',
    'CLAUDE_CODE',
    'CURSOR_AGENT',
    'GEMINI_CLI',
    'ANTIGRAVITY_AGENT',
    'COPILOT_AGENT',
    'COPILOT_CLI',
    'CODEX_THREAD_ID',
    'CODEX_SANDBOX',
    'AI_AGENT',
  ])
    delete env[name]
  const skill = (more: Record<string, string> = {}, ...args: string[]) =>
    spawnSync('node', [cli, 'skill', ...args], { cwd: p.dir, encoding: 'utf8', env: { ...env, ...more } })
      .stdout.trimEnd()
      .split('\n')
  const hookLine =
    'wrote .claude/settings.json: a stop hook. While ubq check finds a problem, the agent cannot end its turn'
  const settings = join(p.dir, '.claude/settings.json')
  // The settings of Claude Code get the stop hook, one time, next to their other settings.
  mkdirSync(join(p.dir, '.claude'))
  writeFileSync(
    settings,
    JSON.stringify({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'a' }] }] } }),
  )
  assert.deepEqual(skill(), ['wrote .claude/skills/use-ubq/SKILL.md', hookLine])
  const hook = { hooks: [{ type: 'command', command: 'npx --no ubq check --hook', timeout: 120 }] }
  assert.deepEqual(JSON.parse(readFileSync(settings, 'utf8')), {
    model: 'x',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'a' }] }, hook] },
  })
  assert.deepEqual(skill(), ['wrote .claude/skills/use-ubq/SKILL.md'])
  rmSync(settings)
  assert.deepEqual(skill(), ['wrote .claude/skills/use-ubq/SKILL.md', hookLine])
  assert.deepEqual(JSON.parse(readFileSync(settings, 'utf8')), { hooks: { Stop: [hook] } })
  // A file that is not JSON stays as it is.
  writeFileSync(settings, '{ // a comment\n}')
  assert.deepEqual(skill(), [
    'wrote .claude/skills/use-ubq/SKILL.md',
    `.claude/settings.json is not JSON, so it has no stop hook. Add "Stop": ${JSON.stringify(hook)} to its "hooks"`,
  ])
  assert.equal(readFileSync(settings, 'utf8'), '{ // a comment\n}')
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

test('doctor: a folder with no package.json, a browser test, a Workers project, and tsconfig files', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
  const doctor = (cmd = 'node', ...args: string[]): string[] =>
    spawnSync(cmd, [...args, cli, 'doctor'], { cwd: p.dir, encoding: 'utf8', env: { ...process.env, CI: '' } })
      .stdout.trimEnd()
      .split('\n')
  const find = (lines: string[], start: string): string | undefined => lines.find(line => line.startsWith(start))

  // A test file for a browser, and the project has no driver.
  writeFileSync(
    join(p.dir, 'page.test.ts'),
    "import { test } from 'ubqtest'\nimport { browser } from 'ubqtest/browser'\ntest('a', async () => void (await browser()))\n",
  )
  assert.equal(
    find(doctor(), 'FIX  a test file imports'),
    "FIX  a test file imports 'ubqtest/browser', and the project does not have playwright-core. Run: npm install --save-dev playwright-core, then: npx ubq browser install",
  )
  rmSync(join(p.dir, 'page.test.ts'))

  // More than one wrangler config, and no vitest config: one entry for each, a folder first.
  mkdirSync(join(p.dir, 'api'))
  writeFileSync(join(p.dir, 'wrangler.jsonc'), '{}')
  writeFileSync(join(p.dir, 'api/wrangler.toml'), '')
  writeFileSync(
    join(p.dir, 'w.test.ts'),
    "import { env } from 'cloudflare:workers'\nimport { test } from 'ubqtest'\ntest('a', () => void env)\n",
  )
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
  symlinkSync(
    fileURLToPath(new URL('../node_modules/wrangler', import.meta.url)),
    join(p.dir, 'node_modules/wrangler'),
    'junction',
  )
  assert.equal(find(doctor(), 'ok   wrangler'), 'ok   wrangler, for tests in the Workers runtime')

  // A tsconfig that the check cannot read, one that extends a second one, and one with no options.
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ not json')
  assert.equal(find(doctor(), 'FIX  tsconfig'), undefined)
  // A base that is not there: the check cannot read the options.
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ "extends": "./base.json" }')
  assert.deepEqual([find(doctor(), 'FIX  tsconfig'), find(doctor(), 'ok   tsconfig')], [undefined, undefined])
  // The options come from the bases, in order, and the config's own
  // options come last. A base can extend a different base.
  const erasable = 'FIX  tsconfig.json: set "erasableSyntaxOnly": true in compilerOptions.'
  writeFileSync(join(p.dir, 'base.json'), '{ "extends": "./base2", "compilerOptions": { "strict": true } }')
  writeFileSync(
    join(p.dir, 'base2.json'),
    '{ "compilerOptions": { "allowImportingTsExtensions": true, "erasableSyntaxOnly": true, "emitDeclarationOnly": true } }',
  )
  assert.equal(find(doctor(), 'ok   tsconfig'), 'ok   tsconfig.json')
  writeFileSync(
    join(p.dir, 'tsconfig.json'),
    '{ "extends": "./base.json", "compilerOptions": { "erasableSyntaxOnly": false } }',
  )
  assert.match(find(doctor(), 'FIX  tsconfig') ?? '', new RegExp(`^${erasable}`))
  // A base from a package, and a list of bases.
  mkdirSync(join(p.dir, 'node_modules/@cfg/strict'), { recursive: true })
  writeFileSync(
    join(p.dir, 'node_modules/@cfg/strict/tsconfig.json'),
    '{ "compilerOptions": { "allowImportingTsExtensions": true, "erasableSyntaxOnly": false, "noEmit": true } }',
  )
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ "extends": "@cfg/strict" }')
  assert.match(find(doctor(), 'FIX  tsconfig') ?? '', new RegExp(`^${erasable}`))
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ "extends": ["@cfg/strict", "./base2.json"] }')
  assert.equal(find(doctor(), 'ok   tsconfig'), 'ok   tsconfig.json')
  // A file of a package by its full name, and a package file with no
  // folder.
  writeFileSync(join(p.dir, 'node_modules/@cfg/erasable.json'), '{ "compilerOptions": { "erasableSyntaxOnly": true } }')
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ "extends": ["@cfg/erasable", "@cfg/strict/tsconfig.json"] }')
  assert.match(find(doctor(), 'FIX  tsconfig') ?? '', new RegExp(`^${erasable}`))
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ "extends": ["@cfg/strict/tsconfig.json", "@cfg/erasable"] }')
  assert.equal(find(doctor(), 'ok   tsconfig'), 'ok   tsconfig.json')
  // No options: both are necessary, also when no test file imports
  // with the .ts extension.
  writeFileSync(join(p.dir, 'tsconfig.json'), '{}')
  assert.equal(
    find(doctor(), 'FIX  tsconfig'),
    'FIX  tsconfig.json: set "allowImportingTsExtensions": true, "erasableSyntaxOnly": true, and "rewriteRelativeImportExtensions": true in compilerOptions. The guides import files with the .ts extension. The runtime runs only TypeScript syntax that it can erase (no enum, no namespace, no parameter properties). This tsconfig makes JavaScript files: tsc then changes the .ts extension of an import to .js. It needs TypeScript 5.7 or later.',
  )

  // The project cannot import ubqtest. The link is a junction on Windows.
  const link = join(p.dir, 'node_modules/ubqtest')
  if (process.platform === 'win32') rmdirSync(link)
  else rmSync(link)
  assert.equal(
    find(doctor(), 'FIX  the project cannot'),
    "FIX  the project cannot import 'ubqtest'. Run: npm install --save-dev ubqtest",
  )
  // No package.json at or above the folder.
  rmSync(join(p.dir, 'package.json'))
  assert.equal(
    find(doctor(), 'FIX  no package.json'),
    `FIX  no package.json at or above ${p.dir}. The folder of package.json is the project. Run: npm init -y`,
  )
})

for (const [cmd, name, ...args] of [
  ['bun', 'Bun'],
  ['deno', 'Deno', 'run', '-A'],
] as const)
  test(
    `doctor names the runtime: ${name}`,
    { skip: spawnSync(cmd, ['--version']).status !== 0 && `${cmd} is not installed` },
    () => {
      const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
      const first = spawnSync(cmd, [...args, cli, 'doctor'], {
        cwd: fileURLToPath(new URL('./fixtures/cov/', import.meta.url)),
        encoding: 'utf8',
      }).stdout.split('\n')[0]!
      assert.match(first, new RegExp(`^ok   ${name} \\d+\\.\\d+`))
    },
  )

test('doctor: the tsconfig.json that has the test files', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  const lines = (): string[] =>
    p
      .ubq('doctor')
      .out.split('\n')
      .filter(line => /tsconfig/.test(line))
  mkdirSync(join(p.dir, 'test/deep'), { recursive: true })
  const source = "import { assert, test } from 'ubqtest'\ntest('a', () => assert(true))\n"
  for (const file of ['test/a.test.ts', 'test/deep/b.test.ts', 'test/c.test.js'])
    writeFileSync(join(p.dir, file), source)
  p.configure({ include: ['test/**/*.test.*'] })
  const options =
    '"compilerOptions": { "noEmit": true, "allowImportingTsExtensions": true, "erasableSyntaxOnly": true }'
  // The config of the source does not have the test files.
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ "compilerOptions": { "noEmit": true }, "include": ["src"] }')
  const start =
    'FIX  2 test files are in no tsconfig.json: test/a.test.ts, test/deep/b.test.ts. The type check of ubq reads the tsconfig.json of each folder from a test file up to the project root (tsconfig.ubq.json, if the folder has one), and no other file name. Add test/tsconfig.json: '
  const end = '. Do not add the test files to the tsconfig.json of the source.'
  assert.deepEqual(lines(), [
    `${start}{"extends":"../tsconfig.json","compilerOptions":{"noEmit":true,"allowImportingTsExtensions":true,"erasableSyntaxOnly":true},"include":["."]}${end}`,
  ])
  // A config for the tests with a different name.
  writeFileSync(join(p.dir, 'tsconfig.test.json'), `{ ${options}, "include": ["test/**/*"] }`)
  assert.deepEqual(lines(), [`${start}{"extends":"../tsconfig.test.json"}${end}`])
  // A project of Nx: tsconfig.json has only references, and the
  // config of the tests is tsconfig.spec.json. The type check makes
  // its own config from that one.
  const before = readFileSync(join(p.dir, 'tsconfig.json'), 'utf8')
  rmSync(join(p.dir, 'tsconfig.test.json'))
  writeFileSync(join(p.dir, 'tsconfig.spec.json'), `{ ${options}, "include": ["test/**/*"] }`)
  writeFileSync(
    join(p.dir, 'tsconfig.json'),
    '{ "files": [], "include": [], "references": [{ "path": "./tsconfig.lib.json" }, { "path": "./tsconfig.spec.json" }] }',
  )
  assert.deepEqual(lines(), ['ok   tsconfig.spec.json'])
  // No referenced config has the test files.
  writeFileSync(join(p.dir, 'tsconfig.spec.json'), `{ ${options}, "include": ["spec/**/*"] }`)
  assert.match(
    lines()[0]!,
    /are in no tsconfig\.json: .*\. tsconfig\.json has only "references" to other configs, and no config of its folder that it references has these files\. .* Add test\/tsconfig\.json: \{"extends":"\.\.\/tsconfig\.json",/,
  )
  // The config that the type check made.
  writeFileSync(join(p.dir, 'tsconfig.ubq.json'), `{ ${options}, "include": ["test/**/*"] }`)
  assert.deepEqual(lines(), ['ok   tsconfig.ubq.json'])
  // It is the config of the folder, also if it does not have the files.
  writeFileSync(join(p.dir, 'tsconfig.ubq.json'), `{ ${options}, "include": ["spec/**/*"] }`)
  assert.match(lines()[0]!, /^FIX  2 test files are in no tsconfig\.json: /)
  rmSync(join(p.dir, 'tsconfig.ubq.json'))
  // No files, and the word is only in a comment.
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ "files": [] /* no "references" */ }')
  assert.match(lines()[0]!, /^FIX  2 test files are in no tsconfig\.json: /)
  writeFileSync(join(p.dir, 'tsconfig.json'), before)
  rmSync(join(p.dir, 'tsconfig.spec.json'))
  writeFileSync(join(p.dir, 'tsconfig.test.json'), `{ ${options}, "include": ["test/**/*"] }`)
  // The options are checked in the config that has the tests.
  writeFileSync(join(p.dir, 'test/tsconfig.json'), '{ "extends": "../tsconfig.test.json" }')
  assert.deepEqual(lines(), ['ok   test/tsconfig.json'])
  writeFileSync(
    join(p.dir, 'test/tsconfig.json'),
    '{ "compilerOptions": { "noEmit": true }, "include": ["."], "exclude": ["deep"] }',
  )
  assert.match(
    lines().join('\n'),
    /^FIX  1 test files are in no tsconfig\.json: test\/deep\/b\.test\.ts\..*\nFIX  test\/tsconfig\.json: set "allowImportingTsExtensions": true and "erasableSyntaxOnly": true in compilerOptions\./,
  )
  rmSync(join(p.dir, 'test/tsconfig.json'))
  // A list of files, a folder with a pattern, and a config with references.
  for (const [config, fine] of [
    ['"files": ["./test/a.test.ts", "test/deep/b.test.ts"]', true],
    ['"files": ["src/a.ts"]', false],
    ['"include": ["test/**/*.ts"]', true],
    ['"include": ["./test/"]', true],
    ['"include": ["test/*/*.js"]', false],
    ['"include": ["."], "exclude": ["test"]', false],
    // References with a list of its own: the check cannot know.
    ['"include": ["lib"], "references": [{ "path": "./src" }]', true],
    // Only references: `tsc -p` of this file reads no file.
    ['"files": [], "references": [{ "path": "./src" }]', false],
  ] as const) {
    writeFileSync(join(p.dir, 'tsconfig.json'), `{ ${options}, ${config} }`)
    assert.deepEqual(
      lines().map(line => line.slice(0, 4)),
      [fine ? 'ok  ' : 'FIX '],
      config,
    )
  }
  // Test files at the root of the project.
  writeFileSync(join(p.dir, 'root.test.ts'), source)
  p.configure({ include: ['root.test.ts'] })
  writeFileSync(join(p.dir, 'tsconfig.json'), `{ ${options}, "include": ["src"] }`)
  assert.deepEqual(lines(), [
    'FIX  1 test files are in no tsconfig.json: root.test.ts. The type check of ubq reads the tsconfig.json of each folder from a test file up to the project root (tsconfig.ubq.json, if the folder has one), and no other file name. Add them to "include" of tsconfig.json.',
  ])
  // More files than the line names.
  for (const n of [1, 2, 3, 4, 5]) writeFileSync(join(p.dir, `test/n${n}.test.ts`), source)
  p.configure({ include: ['test/**/*.test.ts'] })
  assert.match(lines()[0]!, /^FIX  7 test files are in no tsconfig\.json: test\/a\.test\.ts, .*, and 2 more\. /)
  // With no TypeScript test file, the config of the project.
  p.configure({ include: ['test/c.test.js'] })
  assert.deepEqual(lines(), ['ok   tsconfig.json'])
})
