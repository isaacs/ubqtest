// The reader of a vitest config of the Workers plugin, for `ubq
// convert` and `ubq doctor`, and of the define values of a vite
// config.
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { configFolder, playwrightNotes, setupMigrations, viteDefine, vitestWorkers } from '../src/vitest-config.ts'

// See test/convert.test.ts for the reason of this form.
const { parse, children }: typeof import('../src/instrument.ts') = process.versions.deno
  ? await import('../src/instrument.ts')
  : createRequire(import.meta.url)('../src/instrument.ts')

/** The projects of a config text. */
const read = (text: string | undefined, name = 'vitest.config.ts') => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ubq-vitest-')))
  cleanup(() => rmSync(dir, { recursive: true, force: true }))
  if (text !== undefined) writeFileSync(join(dir, name), text)
  return vitestWorkers(dir, parse, children)
}

test('no config, a config that does not parse, and a config with no Workers plugin', () => {
  assert.equal(read(undefined), undefined)
  assert.equal(read('export default {'), undefined)
  assert.equal(read("export default { test: { include: ['a'] } }"), undefined)
})

test('the form with poolOptions, and each kind of plain value', () => {
  const found = read(
    `import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
export default defineWorkersConfig({
  test: {
    include: [\`worker/**/*.test.ts\`],
    setupFiles: './worker/setup.ts',
    poolOptions: {
      workers: {
        wrangler: { configPath: './worker/wrangler.toml' },
        miniflare: {
          bindings: { TEXT: \`plain\`, 'a-key': -1, LIST: [1, 'two'], NESTED: { a: null }, INNER: { [computed]: 1 }, [computed]: 1, CALL: make(), TEMPLATE: \`a\${b}\`, NEGATIVE: -x },
          serviceBindings: { OTHER: () => new Response('no', { status: 500 }) },
          kvPersist: false,
          [computed]: 1,
        },
      },
    },
  },
})
`,
    'vitest.config.mts',
  )
  assert.deepEqual(found, {
    file: 'vitest.config.mts',
    projects: [
      {
        entry: {
          config: 'worker/wrangler.toml',
          include: ['worker/**/*.test.ts'],
          vars: { TEXT: 'plain', 'a-key': -1, LIST: [1, 'two'], NESTED: { a: null } },
        },
        setupFiles: ['worker/setup.ts'],
        notes: [
          'the binding INNER of miniflare.bindings in vitest.config.mts is not a plain value. Add it to "vars" by hand.',
          'the binding (a computed key) of miniflare.bindings in vitest.config.mts is not a plain value. Add it to "vars" by hand.',
          'the binding CALL of miniflare.bindings in vitest.config.mts is not a plain value. Add it to "vars" by hand.',
          'the binding TEMPLATE of miniflare.bindings in vitest.config.mts is not a plain value. Add it to "vars" by hand.',
          'the binding NEGATIVE of miniflare.bindings in vitest.config.mts is not a plain value. Add it to "vars" by hand.',
          'miniflare.serviceBindings in vitest.config.mts is not in the ubq configuration. ubq uses the wrangler config. A service binding to a Worker that is not this one answers fetch with 503. To test code that uses the service, give the handler an env object with your own value for that binding.',
          'miniflare.kvPersist in vitest.config.mts is not in the ubq configuration. ubq uses the wrangler config.',
          'a computed key of miniflare in vitest.config.mts is not in the ubq configuration. ubq uses the wrangler config.',
        ],
      },
    ],
  })
})

test('a project with no config path and no test files, and values that are not plain text', () => {
  const found = read(
    `export default {
  plugins: [cloudflareTest({ miniflare: { bindings: { A: 1 } } })],
  test: { include: patterns, setupFiles: [setup] },
}
`,
  )
  assert.deepEqual(found?.projects, [
    {
      entry: { config: 'wrangler.jsonc', include: ['**/*.test.ts'], vars: { A: 1 } },
      setupFiles: [],
      notes: [
        'test.include in vitest.config.ts is not plain text. Give it by hand.',
        'no wrangler.configPath in vitest.config.ts for this project. Give the path of the wrangler config in "config".',
        'no test.include in vitest.config.ts for this project. Check the globs in "include".',
        'test.setupFiles in vitest.config.ts is not plain text. Give it by hand.',
      ],
    },
  ])
  // With a config in a folder and no test files in the config: the tests of that folder.
  assert.deepEqual(
    read("export default { plugins: [cloudflareTest({ wrangler: { configPath: 'api/wrangler.jsonc' } })] }")
      ?.projects[0]?.entry,
    {
      config: 'api/wrangler.jsonc',
      include: ['api/**/*.test.ts'],
    },
  )
})

test('a setup file: the D1 bindings that it migrates, and if that is all its work', () => {
  assert.deepEqual(
    setupMigrations(
      "import { applyD1Migrations, env } from 'cloudflare:test'\n// Each file.\nawait applyD1Migrations(env.DB, env.TEST_MIGRATIONS)\n",
    ),
    { bindings: ['DB'], only: true },
  )
  assert.deepEqual(
    setupMigrations(
      "import 'side-effect'\nimport {\n  applyD1Migrations,\n  env,\n} from 'cloudflare:test'\n/* two */\napplyD1Migrations(env.A, list);\nawait applyD1Migrations(env.B, list)\nawait applyD1Migrations(env.A, list)\n",
    ),
    { bindings: ['A', 'B'], only: true },
  )
  assert.deepEqual(setupMigrations("import { vi } from 'vitest'\nvi.stubGlobal('x', 1)\n"), {
    bindings: [],
    only: false,
  })
  assert.deepEqual(setupMigrations('await applyD1Migrations(env.DB, m)\nglobalThis.ready = true\n'), {
    bindings: ['DB'],
    only: false,
  })
})

test('the define values of the vite and vitest configs', () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ubq-vite-')))
  cleanup(() => rmSync(dir, { recursive: true, force: true }))
  assert.equal(viteDefine(dir, parse, children), undefined)
  writeFileSync(join(dir, 'vite.config.ts'), 'export default {')
  writeFileSync(join(dir, 'vitest.config.ts'), "export default { test: { include: ['a'] } }")
  assert.equal(viteDefine(dir, parse, children), undefined)
  writeFileSync(join(dir, 'vitest.config.ts'), "import base from '../vite.config'\nexport default { ...base }")
  assert.deepEqual(viteDefine(dir, parse, children), {
    define: {},
    env: {},
    notes: [
      'vitest.config.ts spreads a config from a different file. If that config has define, add its values to "ubq.define" in package.json, such as { "__DEBUG_BUILD__": true }.',
    ],
  })
  writeFileSync(
    join(dir, 'vite.config.ts'),
    `export default {
  define: {
    __DEBUG_BUILD__: 'true',
    VERSION: JSON.stringify('1.2'),
    'LIMIT': 3,
    FLAGS: JSON.stringify({ a: [true] }),
    NAME: '"x"',
    'process.env.MODE': '"test"',
    [key]: 1,
    WINDOW: 'window',
    LATER: JSON.stringify(later),
  },
}`,
  )
  assert.deepEqual(viteDefine(dir, parse, children), {
    define: { __DEBUG_BUILD__: true, VERSION: '1.2', LIMIT: 3, FLAGS: { a: [true] }, NAME: 'x' },
    env: {},
    notes: [
      'vitest.config.ts spreads a config from a different file. If that config has define, add its values to "ubq.define" in package.json, such as { "__DEBUG_BUILD__": true }.',
      'process.env.MODE of define in vite.config.ts is not a global name. ubq sets only global names. Set it in the test by hand.',
      'a computed key of define in vite.config.ts is not a global name. ubq sets only global names. Set it in the test by hand.',
      'the value of WINDOW in the define of vite.config.ts is not a plain value. Add it to "define" by hand.',
      'the value of LATER in the define of vite.config.ts is not a plain value. Add it to "define" by hand.',
    ],
  })
  // A plugin can change the source, and ubq has no plugins.
  writeFileSync(
    join(dir, 'vitest.config.ts'),
    'export default { plugins: [], projects: [{ plugins: [cloudflareTest({})] }] }',
  )
  writeFileSync(join(dir, 'vite.config.ts'), 'export default { plugins: [strip()], test: {} }')
  assert.deepEqual(viteDefine(dir, parse, children), {
    define: {},
    env: {},
    notes: [
      'vite.config.ts has plugins. ubq has no plugins: it runs the source files as they are. If a plugin changes the code that the tests run, tell the user.',
    ],
  })
  // The plugins are in a config that the config imports, at each depth.
  mkdirSync(join(dir, 'shared'), { recursive: true })
  writeFileSync(join(dir, 'vitest.config.ts'), "import base from './shared/base'\nexport default { ...base }")
  writeFileSync(
    join(dir, 'shared/base.ts'),
    "import more from './more.mjs'\nimport './base'\nexport default { ...more, plugins: [] }",
  )
  writeFileSync(join(dir, 'shared/more.mjs'), "import gone from './gone'\nexport default { plugins: [strip()] }")
  writeFileSync(join(dir, 'vite.config.ts'), "import bad from './shared/bad'\nexport default {}")
  writeFileSync(join(dir, 'shared/bad.ts'), 'not code (')
  assert.deepEqual(viteDefine(dir, parse, children)?.notes, [
    'vitest.config.ts imports shared/more.mjs, which has plugins. ubq has no plugins: it runs the source files as they are. If a plugin changes the code that the tests run (it removes a block, or adds an import), tell the user: that source needs a form with no plugin, such as a condition that the code tests while it runs.',
    'vitest.config.ts spreads a config from a different file. If that config has define, add its values to "ubq.define" in package.json, such as { "__DEBUG_BUILD__": true }.',
  ])
  writeFileSync(join(dir, 'vitest.config.ts'), 'export default {}')
  // The time limit of the old config.
  writeFileSync(join(dir, 'vite.config.ts'), 'export default { test: { testTimeout: 60000 } }')
  assert.deepEqual(viteDefine(dir, parse, children), {
    define: {},
    env: {},
    notes: [
      'vite.config.ts has testTimeout: 60000. The time limit of a test in ubq is 5000 ms. To keep the limit of the old config, add to "ubq" in package.json: "timeout": 60000',
    ],
  })
})

test('the notes for a config of Playwright Test: the address of the pages, and other browsers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ubq-playwright-'))
  cleanup(() => rmSync(dir, { recursive: true }))
  assert.deepEqual(playwrightNotes(dir, parse, children), [])
  writeFileSync(
    join(dir, 'playwright.config.ts'),
    "export default defineConfig({ use: { baseURL: 'http://localhost:4173' }, webServer: { command: `npm run preview`, url: 'http://localhost:4173/health' }, projects: [{ name: 'firefox' }] })",
  )
  assert.deepEqual(playwrightNotes(dir, parse, children), [
    'ubq does not read playwright.config.ts. For the address of the pages and the server of the tests, add to "ubq" in package.json: "browser": {"url":"http://localhost:4173","command":"npm run preview"}',
    'playwright.config.ts names a browser that is not Chromium. ubq runs the tests in Chromium only. Tell the user.',
  ])
  // An address that is not text in the file.
  writeFileSync(join(dir, 'playwright.config.ts'), 'export default { use: { baseURL: process.env.URL } }')
  assert.deepEqual(playwrightNotes(dir, parse, children), [
    'ubq does not read playwright.config.ts. If the tests load pages from a server, add its address to "ubq" in package.json: "browser": { "url": "http://localhost:3000", "command": "npm run dev" }',
  ])
  // Only the address of the server.
  writeFileSync(join(dir, 'playwright.config.ts'), "export default { webServer: { url: 'http://localhost:1' } }")
  assert.match(playwrightNotes(dir, parse, children)[0]!, /"browser": \{"url":"http:\/\/localhost:1"\}$/)
  // A file that is not code.
  writeFileSync(join(dir, 'playwright.config.ts'), 'export default {')
  assert.deepEqual(playwrightNotes(dir, parse, children), [])
})

test('the env of a vitest config, and a note for its aliases', () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ubq-vite-')))
  cleanup(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(
    join(dir, 'vitest.config.ts'),
    `export default defineConfig({
  resolve: { alias: { '@lib': path.resolve('lib'), [name]: 'x' } },
  test: { env: { MODE: 'dev', LIMIT: 3, [name]: '1', SECRET: process.env.SECRET }, alias: list },
})`,
  )
  assert.deepEqual(viteDefine(dir, parse, children), {
    define: {},
    env: { MODE: 'dev', LIMIT: '3' },
    notes: [
      'vitest.config.ts has values in test.env that are not plain text (a computed key, SECRET). Add them to "env" in "ubq" in package.json by hand.',
      'vitest.config.ts has an alias for imports (not a plain object, @lib, a computed key). ubq does not change the name of an import. Use a name that the runtime finds: a relative path, the "imports" key of package.json, or a package of the workspace.',
    ],
  })
  writeFileSync(join(dir, 'vitest.config.ts'), 'export default { test: { env: values } }')
  assert.deepEqual(viteDefine(dir, parse, children)?.notes, [
    'vitest.config.ts has values in test.env that are not plain text (not a plain object). Add them to "env" in "ubq" in package.json by hand.',
  ])
})

test('a note for the setup files of a vitest config', () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ubq-vite-')))
  cleanup(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(
    join(dir, 'vitest.config.ts'),
    "export default defineConfig({ test: { setupFiles: ['./test/setup.ts', 'workers/setup.ts'] } })",
  )
  const note = (files: string) =>
    `vitest.config.ts has setup files (${files}). ubq has no setup files. Import each file in each test file that needs it: a hook at the top level of the file is then a hook of that test file.`
  // The setup file of a Workers project has a note of its own.
  assert.deepEqual(viteDefine(dir, parse, children, ['workers/setup.ts'])?.notes, [note('test/setup.ts')])
  writeFileSync(join(dir, 'vitest.config.ts'), "export default { test: { setupFiles: 'setup.ts' } }")
  assert.deepEqual(viteDefine(dir, parse, children)?.notes, [note('setup.ts')])
  writeFileSync(join(dir, 'vitest.config.ts'), 'export default { test: { setupFiles: files } }')
  assert.deepEqual(viteDefine(dir, parse, children)?.notes, [note('not plain text')])
})

test('the config of the workspace root, for a workspace with none', () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ubq-vite-')))
  cleanup(() => rmSync(dir, { recursive: true, force: true }))
  // A folder with no package.json between the workspace and the root.
  const p = join(dir, 'packages', 'p')
  mkdirSync(p, { recursive: true })
  writeFileSync(join(p, 'package.json'), '{}')
  writeFileSync(join(dir, 'vitest.config.ts'), "export default { test: { setupFiles: ['test/setup.ts'] } }")
  // A root with no workspaces is a different project.
  writeFileSync(join(dir, 'package.json'), '{}')
  assert.equal(configFolder(p), p)
  writeFileSync(join(dir, 'package.json'), '{')
  assert.equal(configFolder(p), p)
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages: [packages/*]')
  writeFileSync(join(dir, 'package.json'), '{}')
  assert.equal(configFolder(p), dir)
  rmSync(join(dir, 'pnpm-workspace.yaml'))
  writeFileSync(join(dir, 'package.json'), '{ "workspaces": ["packages/*"] }')
  assert.deepEqual(viteDefine(p, parse, children)?.notes, [
    '../../vitest.config.ts has setup files (../../test/setup.ts). ubq has no setup files. Import each file in each test file that needs it: a hook at the top level of the file is then a hook of that test file.',
  ])
  // A config of the workspace is before the config of the root.
  writeFileSync(join(p, 'vite.config.ts'), 'export default {}')
  assert.equal(configFolder(p), p)
  // A workspace root with no config.
  rmSync(join(p, 'vite.config.ts'))
  rmSync(join(dir, 'vitest.config.ts'))
  assert.equal(configFolder(p), p)
})
