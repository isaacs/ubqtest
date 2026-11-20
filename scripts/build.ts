// Makes the package in `dist/`: the bundled JavaScript, the type
// declarations, and the `package.json` of the published package.
// Publish from that folder: `npm publish ./dist`.
// `node scripts/build.ts <folder>` makes the package in a different
// folder.
import { spawnSync } from 'node:child_process'
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build, type Plugin } from 'esbuild'

const root = new URL('../', import.meta.url)
const dist = pathToFileURL(resolve(process.argv[2] ?? fileURLToPath(new URL('dist', root))) + '/')
const entries = [
  'index',
  'browser',
  'workers',
  'workers-entry',
  'workers-host',
  'cli',
  'preload',
  'counters-preload',
  'child-preload',
  'bun-preload',
  'bun-coverage',
  'instrument',
  'transform',
  'watchdog',
  'warm',
]

// An `import` of `node:fs` or `node:util` makes Node run each lazy
// getter of the module, and load about 40 other modules: 2 to 3 ms
// for each process. `process.getBuiltinModule` gives the module with
// no such cost. The exports are the names that `src/` imports: a
// read of a lazy name runs its getter.
const LAZY = /^node:(fs|util)$/
const builtins: Plugin = {
  name: 'builtins',
  setup(b) {
    b.onResolve({ filter: LAZY }, ({ path, kind, importer }) =>
      kind === 'import-statement' && /[\\/]src[\\/]/.test(importer) ? { path, namespace: 'builtin' } : undefined,
    )
    b.onLoad({ filter: /.*/, namespace: 'builtin' }, ({ path }) => {
      const src = fileURLToPath(new URL('src/', root))
      const names = new Set<string>()
      for (const file of readdirSync(src).filter(name => name.endsWith('.ts'))) {
        const text = readFileSync(src + file, 'utf8')
        const count = (pattern: string): number => text.match(new RegExp(pattern, 'gm'))?.length ?? 0
        const lists = [...text.matchAll(new RegExp(`^import \\{([^}]*)\\} from '${path}'`, 'gm'))]
        // Another form of the import would get no names.
        if (count(`^[^/\\n]*from '${path}'`) - count(`^import type [^']*from '${path}'`) !== lists.length)
          throw new Error(`src/${file}: import names from ${path} with \`import { name } from '${path}'\``)
        for (const [, list] of lists)
          for (const item of list!.split(',')) {
            const name = item.trim().split(/\s+as\s+/)[0]!
            if (name && !name.startsWith('type ')) names.add(name)
          }
      }
      return {
        contents: `const m = process.getBuiltinModule(${JSON.stringify(path)})\nexport default m\nexport const { ${[...names].join(', ')} } = m\n`,
        loader: 'js',
      }
    })
  },
}

rmSync(dist, { recursive: true, force: true })
await build({
  plugins: [builtins],
  absWorkingDir: fileURLToPath(root),
  entryPoints: entries.map(name => `src/${name}.ts`),
  bundle: true,
  // The project that uses `ubqtest/browser` installs this package.
  // workerd has `cloudflare:workers`.
  external: ['playwright-core', 'cloudflare:workers'],
  minify: true,
  // For the tests of ubq in CI: coverage of the built runner is then
  // coverage of `src/` (D55). The published package has no maps.
  sourcemap: !!process.env.UBQ_SOURCEMAP,
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
for (const file of ['README.md', 'LICENSE.md', 'GUIDE.md', 'CONVERT.md', 'skills', 'nvim'])
  cpSync(new URL(file, root), new URL(file, dist), { recursive: true })
