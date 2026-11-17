// Type checks next to the tests, in each run of a TypeScript project.
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
        .slice(-3),
    ],
    [
      0,
      [
        'note: 2 type errors are in files that this run did not use. They are not part of this result. A run of all tests reports them: ubq',
        'skip pass.ts > not on this platform: needs a GPU',
        'pass: 0 failed, 5 passed, 1 skipped',
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
    [1, false, 'fail: 0 failed, 1 passed, 1 type errors'],
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
    '  hint: this is the expected value of assert.equal. It must have the type of the actual value. To compare two different types on purpose: assert.equal<unknown, unknown>(a, b)',
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
    '  hint: Node cannot run this syntax. Change it, or run the tests on Bun (bun node_modules/ubqtest/cli.js) and remove "erasableSyntaxOnly" from the tsconfig.',
    '  at enum.test.ts:2:6',
    '  > enum E {',
  ])
})
