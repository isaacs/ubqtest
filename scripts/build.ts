// Makes the package in `dist/`: the bundled JavaScript, the type
// declarations, and the `package.json` of the published package.
// Publish from that folder: `npm publish ./dist`.
// `node scripts/build.ts <folder>` makes the package in a different
// folder.
import { spawnSync } from 'node:child_process'
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = new URL('../', import.meta.url)
const dist = pathToFileURL(resolve(process.argv[2] ?? fileURLToPath(new URL('dist', root))) + '/')
const entries = ['index', 'browser', 'workers', 'workers-entry', 'workers-host', 'cli', 'preload', 'counters-preload', 'child-preload', 'bun-preload', 'bun-coverage', 'instrument', 'watchdog', 'warm']

rmSync(dist, { recursive: true, force: true })
await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: entries.map(name => `src/${name}.ts`),
  bundle: true,
  // The project that uses `ubqtest/browser` installs this package.
  // workerd has `cloudflare:workers`.
  external: ['playwright-core', 'cloudflare:workers'],
  minify: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outdir: fileURLToPath(dist),
  logLevel: process.argv[2] ? 'warning' : 'info',
})

// The `tsc` command file is a shell script. Windows cannot start it.
const tsc = spawnSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json', '--outDir', fileURLToPath(new URL('types', dist))],
  { cwd: root, stdio: 'inherit' },
)
if (tsc.status) process.exit(tsc.status ?? 1)

const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const manifest = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  license: pkg.license,
  // npm compares this with the repository of the release workflow.
  repository: pkg.repository,
  type: 'module',
  engines: pkg.engines,
  peerDependencies: { 'playwright-core': '>=1.49', wrangler: '>=4' },
  peerDependenciesMeta: { 'playwright-core': { optional: true }, wrangler: { optional: true } },
  bin: { ubq: 'cli.js' },
  exports: {
    '.': { types: './types/index.d.ts', default: './index.js' },
    './browser': { types: './types/browser.d.ts', default: './browser.js' },
    './workers': { types: './types/workers.d.ts', default: './workers.js' },
    './preload': './preload.js',
    './bun-preload': './bun-preload.js',
    './counters-preload': './counters-preload.js',
  },
}
writeFileSync(new URL('package.json', dist), JSON.stringify(manifest, null, 2) + '\n')
for (const file of ['README.md', 'LICENSE.md', 'GUIDE.md', 'CONVERT.md', 'skills'])
  cpSync(new URL(file, root), new URL(file, dist), { recursive: true })
