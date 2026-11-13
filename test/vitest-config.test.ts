// The reader of a vitest config of the Workers plugin, for `ubq
// convert` and `ubq doctor`.
import { createRequire } from 'node:module'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { setupMigrations, vitestWorkers } from '../src/vitest-config.ts'

// See test/convert.test.ts for the reason of this form.
const { parse, children }: typeof import('../src/instrument.ts') =
  process.versions.deno ? await import('../src/instrument.ts') : createRequire(import.meta.url)('../src/instrument.ts')

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
  assert.deepEqual(read("export default { plugins: [cloudflareTest({ wrangler: { configPath: 'api/wrangler.jsonc' } })] }")?.projects[0]?.entry, {
    config: 'api/wrangler.jsonc',
    include: ['api/**/*.test.ts'],
  })
})

test('a setup file: the D1 bindings that it migrates, and if that is all its work', () => {
  assert.deepEqual(
    setupMigrations("import { applyD1Migrations, env } from 'cloudflare:test'\n// Each file.\nawait applyD1Migrations(env.DB, env.TEST_MIGRATIONS)\n"),
    { bindings: ['DB'], only: true },
  )
  assert.deepEqual(
    setupMigrations(
      "import 'side-effect'\nimport {\n  applyD1Migrations,\n  env,\n} from 'cloudflare:test'\n/* two */\napplyD1Migrations(env.A, list);\nawait applyD1Migrations(env.B, list)\nawait applyD1Migrations(env.A, list)\n",
    ),
    { bindings: ['A', 'B'], only: true },
  )
  assert.deepEqual(setupMigrations("import { vi } from 'vitest'\nvi.stubGlobal('x', 1)\n"), { bindings: [], only: false })
  assert.deepEqual(setupMigrations("await applyD1Migrations(env.DB, m)\nglobalThis.ready = true\n"), { bindings: ['DB'], only: false })
})
