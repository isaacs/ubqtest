// Type checks next to the tests, in each run of a TypeScript project.
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { expectedOf } from '../src/typecheck.ts'
import { project } from './setup.ts'

const modules = fileURLToPath(new URL('../node_modules/', import.meta.url))

test('a run reports the type errors of the project', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(
    join(p.dir, 'typed.test.ts'),
    `import { assert, test } from 'ubqtest'
const count: number = 'one'
test('passes at run time', () => {
  assert.ok(count)
})
`,
  )
  // No tsconfig.json: no type check.
  assert.deepEqual([p.ubq().code, p.ubq().last], [1, 'fail: 1 failed, 0 passed'])

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
      include: ['typed.test.ts'],
    }),
  )
  for (const name of ['typescript', '@types'])
    symlinkSync(join(modules, name), join(p.dir, 'node_modules', name), 'junction')
  const all = p.ubq()
  assert.equal(all.code, 1)
  assert.deepEqual(
    all.out
      .replace(/ \(run \d+\)\n$/, '')
      .split('\n')
      .slice(-12),
    [
      'TYPE typed.test.ts',
      "  TS2322: Type 'string' is not assignable to type 'number'.",
      '  at typed.test.ts:2:7',
      "  > const count: number = 'one'",
      '',
      'TYPE typed.test.ts',
      '  TS2349: This expression is not callable.',
      `Type 'Hint<"Use assert(value)">' has no call signatures.`.padStart(58),
      '  at typed.test.ts:4:10',
      '  > assert.ok(count)',
      '',
      'fail: 1 failed, 0 passed, 2 type errors',
    ],
  )
  // The store has the type errors of the run.
  const again = p.ubq('failures')
  assert.deepEqual(
    [again.code, again.out.includes('\nTYPE typed.test.ts\n'), again.last],
    [1, true, 'fail: 1 failed, 0 passed, 2 type errors'],
  )
  // A run of a selection checks the types too. The second run reads
  // the data of the first one, and reports the same errors.
  assert(existsSync(join(p.dir, '.ubq', 'types', 'tsbuildinfo')))
  // The type errors of a file that the run did not use are counted,
  // and the run does not fail for them (D49).
  const one = p.ubq('pass.ts')
  assert.deepEqual(
    [
      one.code,
      one.out
        .replace(/ \(run \d+\)\n$/, '')
        .split('\n')
        .slice(-2),
    ],
    [
      0,
      [
        'skip pass.ts > not on this platform: needs a GPU',
        'pass: 0 failed, 5 passed, 1 skipped, 2 type errors in other files',
      ],
    ],
  )
  const repeat = p.ubq('--repeat', '2', 'pass.ts')
  assert.deepEqual([repeat.code, repeat.out.includes('TS2322')], [0, false])
  // The selected file has the errors: the run fails.
  const own = p.ubq('typed.test.ts')
  assert.deepEqual([own.code, own.last], [1, 'fail: 1 failed, 0 passed, 2 type errors'])

  // More than 20 errors get a count, not a block.
  const consts = Array.from({ length: 22 }, (_, i) => `const n${i}: number = 'x'`).join('\n')
  writeFileSync(join(p.dir, 'typed.test.ts'), `${consts}\n`)
  const many = p.ubq().out
  const run = /\(run (\d+)\)\n$/.exec(many)?.[1]
  assert.deepEqual(
    [many.split('\n').filter(l => l.startsWith('TYPE ')).length, many.match(/^and \d+ more.*$/m)?.[0]],
    [20, `and 2 more type errors. For all of them: ubq failures ${run}`],
  )
  // ubq failures shows all of them.
  assert.equal(
    p
      .ubq('failures')
      .out.split('\n')
      .filter(l => l.startsWith('TYPE ')).length,
    22,
  )
  // An error with no file.
  writeFileSync(
    join(p.dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { noEmit: true, types: ['no-such-types'] }, include: ['typed.test.ts'] }),
  )
  assert.match(p.ubq().out, /^TYPE \(no file\)\n  TS2688: Cannot find type definition file for 'no-such-types'\./m)
})

test('a folder with its own tsconfig.json is checked for its test files', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  const config = (include: string[]) =>
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        target: 'esnext',
        strict: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        types: ['node'],
      },
      include,
    })
  const source = (name: string) => `import { assert, test } from 'ubqtest'
const count: number = '${name}'
test('${name}', () => {
  assert(count)
})
`
  for (const name of ['typescript', '@types'])
    symlinkSync(join(modules, name), join(p.dir, 'node_modules', name), 'junction')
  mkdirSync(join(p.dir, 'second'))
  writeFileSync(join(p.dir, 'tsconfig.json'), config(['first.test.ts']))
  writeFileSync(join(p.dir, 'first.test.ts'), source('first'))
  // The config of the root does not have this file.
  writeFileSync(join(p.dir, 'second/tsconfig.json'), config(['*.ts']))
  writeFileSync(join(p.dir, 'second/second.test.ts'), source('second'))
  const all = p.ubq()
  assert.deepEqual(
    [all.code, all.last, all.out.includes('at first.test.ts:2:7'), all.out.includes('at second/second.test.ts:2:7')],
    [1, 'fail: 0 failed, 2 passed, 2 type errors', true, true],
  )
  const one = p.ubq('second/second.test.ts')
  assert.deepEqual(
    [one.code, one.out.includes('first.test.ts'), one.last],
    [1, false, 'fail: 0 failed, 1 passed, 1 type error, 1 type error in other files'],
  )
  // The run does not print the error of the other file. The store
  // has it, and `ubq failures` prints it.
  const stored = p.ubq('failures')
  assert.deepEqual(
    [stored.out.includes('at second/second.test.ts:2:7'), stored.out.includes('at first.test.ts:2:7'), stored.last],
    [true, true, 'fail: 0 failed, 1 passed, 1 type error, 1 type error in other files'],
  )
})

test('a TypeScript with no native program, and a native program that does not start', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  writeFileSync(join(p.dir, 'tsconfig.json'), JSON.stringify({ include: ['pass.ts'] }))
  // A package with only the JavaScript program, which prints one error.
  const ts = join(p.dir, 'node_modules/typescript')
  mkdirSync(join(ts, 'bin'), { recursive: true })
  writeFileSync(join(ts, 'package.json'), JSON.stringify({ name: 'typescript', bin: { tsc: './bin/tsc' } }))
  writeFileSync(join(ts, 'bin/tsc'), "console.log('pass.ts(1,1): error TS1000: from the program of the package')\n")
  const old = p.ubq('pass.ts')
  assert.deepEqual(
    [old.code, old.out.split('\n').slice(0, 2)],
    [1, ['TYPE pass.ts', '  TS1000: from the program of the package']],
  )
  // A program that fails with no error list, and one that the
  // system stops, have no result.
  writeFileSync(join(ts, 'bin/tsc'), "console.error('out of memory')\nprocess.exit(3)\n")
  const failed = p.ubq('pass.ts')
  assert.deepEqual(
    [failed.code, failed.out.split('\n').slice(0, 3)],
    [
      1,
      [
        'TYPE (no file)',
        '  ubq: the type checker of tsconfig.json stopped with exit code 3, and its result is not complete. Run again.',
        '  out of memory',
      ],
    ],
  )
  // Windows has no signals: a program that is stopped there ends
  // with exit code 1, as a checker with errors does. ubq can only
  // see it if the program wrote no error.
  writeFileSync(
    join(ts, 'bin/tsc'),
    `${process.platform === 'win32' ? '' : "console.log('pass.ts(1,1): error TS1000: one')\n"}process.kill(process.pid, 'SIGKILL')\nsetTimeout(() => {}, 9999)\n`,
  )
  const killed = p.ubq('pass.ts')
  assert.equal(killed.code, 1)
  assert.match(killed.out, /^  ubq: the type checker of tsconfig\.json stopped with (SIGKILL|exit code 1), and/m)
  // A native program that is not a program.
  const native = join(p.dir, `node_modules/@typescript/typescript-${process.platform}-${process.arch}`)
  mkdirSync(join(native, 'lib'), { recursive: true })
  writeFileSync(join(native, 'package.json'), '{}')
  writeFileSync(join(native, 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc'), 'not a program')
  const broken = p.ubq('pass.ts')
  assert.deepEqual([broken.code, broken.out.split('\n')[0]], [1, 'TYPE (no file)'])
  assert.match(broken.out, /^  ubq: the type checker did not start: /m)
})

test('the place of a type error in the expected value of an assertion', () => {
  // The place is the character after `^`.
  const at = (code: string): string | undefined => expectedOf(code.replace('^', ''), code.indexOf('^'))
  assert.equal(at('assert.equal(a, ^b)'), 'equal')
  assert.equal(at('assert.deepEqual<{ a: 1 }>(f(a, b), { k: [1, { j: 2 }], v: ^b })'), 'deepEqual')
  assert.equal(at('assert.notEqual(a, [1, ^b])'), 'notEqual')
  // The actual value, an argument of an other call, and code that is not in a call.
  assert.equal(at('assert.equal(^a, b)'), undefined)
  assert.equal(at('assert.equal(a, f(x, ^y))'), undefined)
  assert.equal(at('other(a, ^b)'), undefined)
  assert.equal(at('const a: number = ^b'), undefined)
})

test('a type error in the expected value of an assertion has a hint', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  for (const name of ['typescript', '@types'])
    symlinkSync(join(modules, name), join(p.dir, 'node_modules', name), 'junction')
  writeFileSync(
    join(p.dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: ['node'] }, include: ['hint.test.ts'] }),
  )
  writeFileSync(
    join(p.dir, 'hint.test.ts'),
    `import { assert, test } from 'ubqtest'
const f = (a: string | null, b: string | undefined): void => {
  assert.equal(a, b)
  assert.deepEqual({ v: a }, { v: b })
}
test('t', () => f('x', 'x'))
`,
  )
  const hints = p
    .ubq('hint.test.ts')
    .out.split('\n')
    .filter(line => line.startsWith('  hint: ') || line.startsWith('  at '))
  assert.deepEqual(hints, [
    '  hint: this is the expected value of assert.equal. It must have the type of the actual value. To compare two different types on purpose: assert.equal<unknown>(a, b)',
    '  at hint.test.ts:3:19',
    '  hint: this is the expected value of assert.deepEqual. It must have the type of the actual value. To compare two different types on purpose: assert.deepEqual<unknown>(a, b)',
    '  at hint.test.ts:4:32',
  ])
})

test('a type error for syntax that Node cannot run has a hint', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  for (const name of ['typescript', '@types'])
    symlinkSync(join(modules, name), join(p.dir, 'node_modules', name), 'junction')
  writeFileSync(
    join(p.dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, erasableSyntaxOnly: true, types: ['node'] },
      include: ['enum.test.ts'],
    }),
  )
  writeFileSync(
    join(p.dir, 'enum.test.ts'),
    "import { assert, test } from 'ubqtest'\nenum E {\n  A,\n}\ntest('t', () => assert.equal(E.A, 0))\n",
  )
  const lines = p.ubq('enum.test.ts').out.split('\n')
  const at = lines.indexOf('TYPE enum.test.ts')
  assert.deepEqual(lines.slice(at, at + 5), [
    'TYPE enum.test.ts',
    "  TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.",
    '  hint: Node cannot run this syntax with only its types removed. Change this syntax, or run `ubq doctor`: it has the three other choices for the person who owns the project.',
    '  at enum.test.ts:2:6',
    '  > enum E {',
  ])
})

test('a tsconfig.json with only references: ubq makes tsconfig.ubq.json, one time, and reads it', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  for (const name of ['typescript', '@typescript', '@types'])
    symlinkSync(join(modules, name), join(p.dir, 'node_modules', name), 'junction')
  // A monorepo as Nx makes it: the base config at the root, and in
  // each project a config with only references.
  const write = (file: string, value: unknown): void =>
    writeFileSync(join(p.dir, file), typeof value === 'string' ? value : JSON.stringify(value))
  for (const dir of ['libs/common/src', 'apps/app/src']) mkdirSync(join(p.dir, dir), { recursive: true })
  write('tsconfig.base.json', {
    compilerOptions: {
      module: 'nodenext',
      target: 'esnext',
      strict: true,
      composite: true,
      declaration: true,
      emitDeclarationOnly: true,
      allowImportingTsExtensions: true,
      skipLibCheck: true,
      types: ['node'],
      paths: { '@x/common': ['./libs/common/src/index.ts'] },
    },
  })
  for (const dir of ['libs/common', 'apps/app']) {
    // With a comment and a last comma, as a tsconfig file can have.
    write(
      `${dir}/tsconfig.json`,
      '{\n  // the projects\n  "extends": "../../tsconfig.base.json", "files": [], "include": [],\n  "references": [{ "path": "./tsconfig.lib.json" }, { "path": "./tsconfig.spec.json" }, { "path": "../other" },],\n}',
    )
    write(`${dir}/tsconfig.lib.json`, {
      extends: './tsconfig.json',
      compilerOptions: { outDir: '../../dist/lib' },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
    })
    write(`${dir}/tsconfig.spec.json`, {
      extends: ['./tsconfig'],
      include: ['src/**/*.spec.ts'],
      references: [{ path: './tsconfig.lib.json' }, { path: '../../libs/common/tsconfig.lib.json' }],
    })
  }
  write('libs/common/src/index.ts', 'export const add = (a: number, b: number): number => a + b\n')
  // The source of a different project, by a path of `paths`.
  write(
    'apps/app/src/three.spec.ts',
    "import { assert, test } from 'ubqtest'\nimport type * as common from '@x/common'\nconst text: string = 0 as unknown as typeof common.add\ntest('three', () => assert.equal<unknown>(text, 0))\n",
  )
  p.configure({ include: ['**/src/**/*.spec.ts'] })
  const first = p.ubq('apps/app/src/three.spec.ts')
  assert.equal(
    first.err,
    'note: ubq wrote apps/app/tsconfig.ubq.json for its type check. apps/app/tsconfig.json has only "references", and "tsc -p" of it reads no file. The new file extends apps/app/tsconfig.spec.json. Commit it.\n',
  )
  // The one error is the error of the test file: no TS6305 for the
  // project that is not built, and no TS6059 for a file out of the
  // folder.
  assert.deepEqual(first.out.split('\n').slice(0, 4), [
    'TYPE apps/app/src/three.spec.ts',
    "  TS2322: Type '(a: number, b: number) => number' is not assignable to type 'string'.",
    '  at apps/app/src/three.spec.ts:3:7',
    '  > const text: string = 0 as unknown as typeof common.add',
  ])
  assert.match(first.last!, /^fail: 0 failed, 1 passed, 1 type error$/)
  const made = join(p.dir, 'apps/app/tsconfig.ubq.json')
  assert.deepEqual(JSON.parse(readFileSync(made, 'utf8').replace(/^\/\/.*\n/gm, '')), {
    extends: './tsconfig.spec.json',
    compilerOptions: { composite: false, noEmit: true, rootDir: '../..' },
  })
  // No config for a folder with no test file of the run.
  assert(!existsSync(join(p.dir, 'libs/common/tsconfig.ubq.json')))
  // The file is of the project now: ubq reads it, and does not write it.
  writeFileSync(made, readFileSync(made, 'utf8').replace('"noEmit": true', '"noEmit": true, "noImplicitAny": false'))
  write(
    'apps/app/src/three.spec.ts',
    "import { assert, test } from 'ubqtest'\nconst f = (a) => a\ntest('three', () => assert.equal(f(1), 1))\n",
  )
  const second = p.ubq('apps/app/src/three.spec.ts')
  assert.deepEqual([second.err, second.last], ['', 'pass: 0 failed, 1 passed'])
  assert.match(readFileSync(made, 'utf8'), /"noImplicitAny": false/)
  // `ubq doctor` reads the options of the same file.
  assert.match(p.ubq('doctor').out, /^FIX  apps\/app\/tsconfig\.ubq\.json: set /m)
})

test('a referenced project that is not built has a hint', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  for (const name of ['typescript', '@typescript', '@types'])
    symlinkSync(join(modules, name), join(p.dir, 'node_modules', name), 'junction')
  mkdirSync(join(p.dir, 'lib'))
  const options = {
    module: 'nodenext',
    target: 'esnext',
    strict: true,
    allowImportingTsExtensions: true,
    types: ['node'],
  }
  writeFileSync(
    join(p.dir, 'lib/tsconfig.json'),
    JSON.stringify({ compilerOptions: { ...options, composite: true, emitDeclarationOnly: true, outDir: 'out' } }),
  )
  writeFileSync(join(p.dir, 'lib/one.ts'), 'export const one = 1\n')
  writeFileSync(
    join(p.dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { ...options, noEmit: true },
      include: ['ref.test.ts'],
      references: [{ path: './lib' }],
    }),
  )
  writeFileSync(
    join(p.dir, 'ref.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { one } from './lib/one.ts'\ntest('one', () => assert.equal(one, 1))\n",
  )
  const lines = p.ubq('ref.test.ts').out.split('\n')
  const at = lines.findIndex(line => line.startsWith('  TS6305: '))
  assert.equal(
    lines[at + 1],
    '  hint: the tsconfig has "references", and the checker reads a referenced project from its build output, which is not there or is old. Build the referenced projects (tsc -b), in CI too, before the tests.',
  )
})

test('with the skipTypecheck key, a run does not check the types', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  for (const name of ['typescript', '@typescript', '@types'])
    symlinkSync(join(modules, name), join(p.dir, 'node_modules', name), 'junction')
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
      include: ['wrong.test.ts'],
    }),
  )
  writeFileSync(
    join(p.dir, 'wrong.test.ts'),
    "import { assert, test } from 'ubqtest'\nconst n: number = 'x' as never as string\ntest('runs', () => assert(n))\n",
  )
  assert.equal(p.ubq('wrong.test.ts').last, 'fail: 0 failed, 1 passed, 1 type error')
  p.configure({ skipTypecheck: true })
  assert.equal(p.ubq('wrong.test.ts').last, 'pass: 0 failed, 1 passed')
  assert.equal(p.ubq('wrong.test.ts', 'pass.ts').last, 'pass: 0 failed, 6 passed, 1 skipped')
})
