// Annotations for GitHub Actions: failures, type errors, and code that
// no test ran, in the view of the changes of a pull request (D71).
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, env, test } from 'ubqtest'
import { cli, project, remove } from './setup.ts'

// The library loads the module before coverage starts: a copy has counts.
const { annotation }: typeof import('../src/annotate.ts') = await import('../src/annotate.ts?copy' as string)

test('annotation: the form of GitHub, with its escapes', () => {
  env({ GITHUB_WORKSPACE: undefined })
  assert.equal(
    annotation('error', { file: 'a.ts', line: 3, column: 5 }, 'FAIL a, b: c', 'one\ntwo 100%'),
    '::error file=a.ts,line=3,col=5,title=FAIL a%2C b%3A c::one%0Atwo 100%25\n',
  )
  assert.equal(
    annotation('warning', { file: 'a.ts', line: 1, endLine: 4 }, 't', 'm'),
    '::warning file=a.ts,line=1,endLine=4,title=t::m\n',
  )
  assert.equal(annotation('error', undefined, 't', 'm\r'), '::error title=t::m%0D\n')
})

test('annotation: a path from the root of the repository', () => {
  const root = dirname(process.cwd())
  env({ GITHUB_WORKSPACE: root })
  const below = process
    .cwd()
    .slice(root.length + 1)
    .split('\\')
    .join('/')
  assert.equal(annotation('error', { file: 'a.ts' }, 't', 'm'), `::error file=${below}/a.ts,title=t::m\n`)
  // A project outside the workspace keeps its own paths.
  env({ GITHUB_WORKSPACE: join(process.cwd(), 'elsewhere') })
  assert.equal(annotation('error', { file: 'a.ts' }, 't', 'm'), '::error file=a.ts,title=t::m\n')
})

test('a run in GitHub Actions annotates its failures, and ubq failures does not', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  // The project is a folder of the repository.
  const dir = join(p.dir, 'pkg')
  mkdirSync(dir)
  writeFileSync(join(dir, 'package.json'), '{ "type": "module" }')
  mkdirSync(join(dir, 'node_modules'))
  writeFileSync(
    join(dir, 'a.test.ts'),
    "import { assert, test } from 'ubqtest'\ntest('one', () => {\n  assert.equal(1, 2)\n})\n",
  )
  writeFileSync(join(dir, 'b.test.ts'), "import { test } from 'ubqtest'\nthrow new Error('boom')\n")
  symlinkSync(realpathSync(join(p.dir, 'node_modules', 'ubqtest')), join(dir, 'node_modules', 'ubqtest'), 'junction')
  const ubq = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, CI: '', GITHUB_ACTIONS: 'true', GITHUB_WORKSPACE: p.dir },
    }).stdout
  const out = ubq('a.test.ts', 'b.test.ts')
  assert.match(
    out,
    /^::error file=pkg\/a\.test\.ts,line=3,col=\d+,title=FAIL a\.test\.ts > one::expected values to be equal%0A.*%0Arerun: ubq a\.test\.ts:2\nFAIL a\.test\.ts > one$/m,
  )
  assert.match(
    out,
    /^::error file=pkg\/b\.test\.ts,line=2,col=\d+,title=ERROR b\.test\.ts::.*boom.*\nERROR b\.test\.ts$/m,
  )
  assert(!ubq('failures').includes('::error'))
})

test('ubq uncovered in GitHub Actions annotates each range, and each file that no test loads', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  mkdirSync(join(p.dir, 'lib'))
  writeFileSync(
    join(p.dir, 'lib/a.ts'),
    'export const a = (n: number): number => {\n  if (n) return 1\n  return 0\n}\n',
  )
  writeFileSync(
    join(p.dir, 'a.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { a } from './lib/a.ts'\ntest('t', () => assert.equal(a(1), 1))\n",
  )
  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: p.dir,
    })
  writeFileSync(join(p.dir, '.gitignore'), 'node_modules\n.ubq\n')
  git('init', '-q')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  writeFileSync(join(p.dir, 'lib/b.ts'), 'export const b = 1\n')
  assert.equal(p.ubq('a.test.ts').code, 0)
  const r = spawnSync(process.execPath, [cli, 'uncovered'], {
    cwd: p.dir,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'true' },
  })
  assert.equal(
    r.stdout.split('\n').slice(0, 2).join('\n'),
    '::warning file=lib/a.ts,line=3,col=3,endLine=3,title=ran in no test::return 0\nlib/a.ts:3:3  return 0',
  )
  const diff = spawnSync(process.execPath, [cli, 'uncovered', '--diff'], {
    cwd: p.dir,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'true' },
  })
  assert.match(
    diff.stdout,
    /^::warning file=lib\/b\.ts,title=no test loads this file::lib\/b\.ts\nlib\/b\.ts {2}no test loads this file$/m,
  )
})

test('a run in GitHub Actions writes a summary of the step: the result, and a table of the failures', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  const file = join(p.dir, 'summary.md')
  // 21 failures, and a file that throws: the table has 20 rows.
  writeFileSync(
    join(p.dir, 'a.test.ts'),
    "import { assert, test } from 'ubqtest'\n" +
      Array.from(
        { length: 21 },
        (_, i) => `test('t${String(i).padStart(2, '0')} | x', () => assert.equal(${i}, -1))\n`,
      ).join(''),
  )
  writeFileSync(join(p.dir, 'b.test.ts'), "import { test } from 'ubqtest'\nthrow new Error('boom')\n")
  writeFileSync(
    join(p.dir, 'lib.ts'),
    'export const many = (n: number): boolean => {\n  if (n > 2) return true\n  return false\n}\n',
  )
  writeFileSync(
    join(p.dir, 'c.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { many } from './lib.ts'\ntest('c', () => assert(many(3)))\n",
  )
  const env = { ...process.env, CI: '', GITHUB_STEP_SUMMARY: file }
  const ubq = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: p.dir, encoding: 'utf8', env })
  ubq('a.test.ts', 'b.test.ts')
  const md = readFileSync(file, 'utf8').split('\n')
  assert.equal(md[0], '### ubq: fail: 1 error, 21 failed, 0 passed (run 1)')
  assert.equal(md[2], '| | Test or file | Failure | At | Run again |')
  assert.match(
    md[4]!,
    /^\| (FAIL \| a\.test\.ts > t\d\d \\\| x \| expected values to be equal \| a\.test\.ts:\d+:\d+ \| `ubq a\.test\.ts:\d+`|ERROR \| b\.test\.ts \| .*boom.* \| b\.test\.ts:2:\d+ \| `ubq b\.test\.ts`) \|$/,
  )
  assert.equal(md.filter(l => /^\| (FAIL|ERROR) /.test(l)).length, 20)
  assert.equal(md[25], 'And 2 more. For all of them: `ubq failures 1`')
  // A pass, with code that no test ran: one more section. On Node: a
  // run of one file on Deno, or on some versions of Bun, has no
  // coverage.
  spawnSync('node', [cli, 'c.test.ts'], { cwd: p.dir, env })
  const second = readFileSync(file, 'utf8').split('### ')[2]!
  assert.match(
    second,
    /^ubq: pass: 0 failed, 1 passed \(run 2\)\n\n- 1 range of code in the files of this run ran in no test: `ubq uncovered`\n\n$/,
  )
  // A second print of stored failures writes no summary.
  const before = readFileSync(file, 'utf8')
  ubq('failures', '1')
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('the summary of a step has type errors, and the count of those in files that the run did not use', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  const file = join(p.dir, 'summary.md')
  writeFileSync(
    join(p.dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        target: 'esnext',
        strict: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        types: ['node'],
      },
      include: ['*.ts'],
    }),
  )
  const modules = fileURLToPath(new URL('../node_modules/', import.meta.url))
  for (const name of ['typescript', '@types'])
    symlinkSync(join(modules, name), join(p.dir, 'node_modules', name), 'junction')
  writeFileSync(
    join(p.dir, 'a.test.ts'),
    "import { assert, test } from 'ubqtest'\nconst n: number = 'one'\ntest('a', () => assert(n))\n",
  )
  writeFileSync(join(p.dir, 'other.ts'), "export const m: number = 'two'\n")
  spawnSync(process.execPath, [cli, 'a.test.ts'], {
    cwd: p.dir,
    env: { ...process.env, CI: '', GITHUB_STEP_SUMMARY: file },
  })
  const md = readFileSync(file, 'utf8')
  assert.match(md, /^\| TYPE \| a\.test\.ts \| TS2322: .* \| a\.test\.ts:2:7 \|  \|$/m)
  assert.match(md, /^- 1 type error in files that this run did not use\.$/m)
})
