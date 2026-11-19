// The `transform` key: a compiler of the project makes the
// JavaScript of each TypeScript file (D111).
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { transformer } from '../src/transform.ts'
import { addCommand } from '../src/transform-setup.ts'
import { cli, project } from './setup.ts'

const modules = fileURLToPath(new URL('../node_modules/', import.meta.url))
// The package of each compiler, in the modules of this repository.
const PACKAGES = { typescript: ['typescript5', 'typescript'], swc: ['@swc', '@swc'] } as const
type Compiler = keyof typeof PACKAGES

/** A project with the compiler, the key, and a tsconfig with the options. */
const transformProject = (compiler: Compiler, options: Record<string, unknown>, type?: 'module') => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  const [from, to] = PACKAGES[compiler]
  symlinkSync(join(modules, from), join(p.dir, 'node_modules', to), 'junction')
  const write = (file: string, text: string): void => {
    mkdirSync(join(p.dir, file, '..'), { recursive: true })
    writeFileSync(join(p.dir, file), text)
  }
  write('package.json', JSON.stringify({ type, ubq: { transform: compiler, include: ['spec/**/*.spec.ts'] } }))
  // The type check reads only this one file: the source of ubq is
  // not for the options of this project.
  write('only.d.ts', 'export {}\n')
  const config = (more: Record<string, unknown> = {}): void =>
    write('tsconfig.json', JSON.stringify({ compilerOptions: { ...options, ...more }, include: ['only.d.ts'] }))
  config()
  return { ...p, write, config }
}

const NEST = { module: 'commonjs', target: 'es2021', experimentalDecorators: true, emitDecoratorMetadata: true }

const SERVICE = `import { Dep, Shape } from './dep'
import { scale } from './scale'

export enum Color {
  Red,
  Green,
}
const Injectable = (): ClassDecorator => target => {
  ;(target as unknown as { injectable: boolean }).injectable = true
}

@Injectable()
export class Service {
  constructor(
    private readonly dep: Dep,
    public shape: Shape,
  ) {}
  get(): number {
    return scale(this.dep.value) + Color.Green
  }
  boom(): never {
    throw new Error('boom')
  }
  never(): number {
    return 0
  }
}
`
const DEP = `export interface Shape {
  name: string
}
export class Dep {
  value = 1
}
`

for (const compiler of ['typescript', 'swc'] as const) {
  test(`${compiler}: a CommonJS project with decorators, metadata, an enum, and a parameter property`, () => {
    const p = transformProject(compiler, NEST)
    p.write('src/service.ts', SERVICE)
    p.write('src/dep.ts', DEP)
    p.write('src/scale.ts', 'export const scale = (n: number): number => n * 10\n')
    // The metadata of a decorator goes to this function. It is in
    // a module of its own: each import of a file runs before the
    // other code of the file.
    p.write(
      'spec/reflect.ts',
      `export const meta: unknown[][] = []
;(Reflect as unknown as { metadata: unknown }).metadata = (key: string, value: unknown) => () => {
  meta.push([key, ...[value].flat().map(one => (one as { name: string }).name)])
}
`,
    )
    p.write(
      'spec/a.spec.ts',
      `import { assert, mockImport, test } from 'ubqtest'
import { meta } from './reflect'
import { Dep } from '../src/dep'
import { Color, Service } from '../src/service'

test('the code runs', () => {
  const service = new Service(new Dep(), { name: 'x' })
  assert.equal(service.get(), 11)
  assert.equal(service.shape.name, 'x')
  assert.equal(Color[Color.Green], 'Green')
  assert.equal((Service as unknown as { injectable: boolean }).injectable, true)
  // An interface has no value: its place in the metadata is Object.
  assert.deepEqual(
    meta.filter(one => one[0] === 'design:paramtypes'),
    [['design:paramtypes', 'Dep', 'Object']],
  )
})
test('an error has the place of the source', () => {
  new Service(new Dep(), { name: 'x' }).boom()
})
test('a mock in a new instance, at each depth', async () => {
  const { Service: Mocked } = await mockImport(() => import('../src/service'), [
    [() => import('../src/scale'), { scale: (n: number) => n + 100 }],
  ])
  assert.equal(new Mocked(new Dep(), { name: 'x' }).get(), 102)
  // The first instance has the real module.
  assert.equal(new Service(new Dep(), { name: 'x' }).get(), 11)
})
`,
    )
    // Two modules that import each other, a module of Node, a
    // default export, and a module whose export is not an object.
    p.write(
      'src/first.ts',
      "import { second } from './second'\nimport { Dep } from './dep'\nexport const base = 'A'\nexport const first = (): string => 'a' + new Dep().value + second()\n",
    )
    p.write(
      'src/second.ts',
      "import { existsSync } from 'fs'\nimport { EOL } from 'node:os'\nimport { isDeepEqual } from 'ubqtest'\nimport { base } from './first'\nimport { Dep } from './dep'\nimport name from './name'\nexport const second = (): string => base + new Dep().value + typeof existsSync + name() + EOL + isDeepEqual(1, 1)\n",
    )
    p.write('src/name.ts', "export default (): string => 'real'\n")
    p.write('src/five.ts', 'const five = 5\nexport = five\n')
    p.write('src/lost.ts', "import './nope'\n")
    p.write('src/late.ts', 'export const late = 1\n')
    p.write(
      'spec/mock.spec.ts',
      `import { EOL } from 'node:os'
import { assert, mockImport, test } from 'ubqtest'
import { first } from '../src/first'

test('the modules of an instance', async () => {
  assert.equal(first(), 'a1A1functionreal\\ntrue'.replace('\\n', EOL))
  const mocked = await mockImport(() => import('../src/first'), [
    [() => import('fs'), { existsSync: 1 as never }],
    [() => import('node:os'), { EOL: '!' }],
    [() => import('../src/name'), { default: () => 'mock' }],
  ])
  assert.equal(mocked.first(), 'a1A1numbermock!true')
  assert.equal((await mockImport(() => import('../src/five'), [])).default, 5)
  await assert.rejects(mockImport(() => import('../src/lost'), []), /Cannot find module '\\.\\/nope'/)
  // A module that loads after a mock, and is in no instance.
  assert.equal((await import('../src/late')).late, 1)
})
`,
    )
    p.write(
      'spec/b.spec.ts',
      "import { assert, test } from 'ubqtest'\nimport { Dep } from '../src/dep'\ntest('b', () => assert.equal(new Dep().value, 1))\n",
    )
    const all = p.ubq()
    assert.deepEqual(
      [
        all.err,
        all.out
          .split('\n')
          .slice(0, 5)
          .map(line => line.replace(/(spec\.ts:19):\d+$/, '$1')),
        all.last,
      ],
      [
        '',
        [
          'FAIL spec/a.spec.ts > an error has the place of the source',
          '  Error: boom',
          '  at src/service.ts:22:11',
          "  > throw new Error('boom')",
          // The column of the call is not the same for each compiler.
          '  at spec/a.spec.ts:19',
        ],
        'fail: 1 failed, 4 passed',
      ],
    )
    // Coverage has the places of the source.
    assert.deepEqual(p.ubq('uncovered', 'src/service.ts').out.split('\n').slice(0, 2), [
      'src/service.ts:24:3  never(): number { (+2 lines)',
      '1 uncovered ranges in src/service.ts',
    ])
    // The JavaScript is in the cache, with its module system.
    const entries = readdirSync(join(p.dir, '.ubq/counters')).map(
      name => JSON.parse(readFileSync(join(p.dir, '.ubq/counters', name), 'utf8')) as { format?: string; js: string },
    )
    assert.deepEqual(
      [entries.length, entries.every(e => e.format === 'commonjs' && e.js.includes('exports'))],
      [13, true],
    )
    // One file runs in the process of the runner.
    const one = p.ubq('spec/a.spec.ts')
    assert.deepEqual([one.out.split('\n')[2], one.last], ['  at src/service.ts:22:11', 'fail: 1 failed, 2 passed'])
    // An option of the tsconfig changes the JavaScript.
    p.config({ emitDecoratorMetadata: false })
    assert.match(p.ubq().out, /FAIL spec\/a\.spec\.ts > the code runs\n {2}expected values to be deeply equal/)
  })

  test(`${compiler}: a project of ES modules, with an enum and a decorator of JavaScript`, () => {
    const p = transformProject(compiler, { module: 'nodenext', target: 'es2022' }, 'module')
    p.write(
      'src/log.ts',
      `export enum Level {
  Info = 'info',
}
const calls: string[] = []
const logged = <T extends (...args: never[]) => unknown>(method: T, context: ClassMethodDecoratorContext): T =>
  function (this: unknown, ...args: never[]) {
    calls.push(String(context.name))
    return method.apply(this, args)
  } as T
export class Log {
  constructor(readonly level: Level) {}
  @logged
  write(text: string): string {
    return \`\${this.level}: \${text}\`
  }
  calls(): string[] {
    return calls
  }
}
`,
    )
    p.write(
      'spec/log.spec.ts',
      `import { assert, mockImport, test } from 'ubqtest'
import { Level, Log } from '../src/log.ts'
import type { Level as OnlyType } from '../src/log.ts'

test('the code runs', async () => {
  const level: OnlyType = Level.Info
  const log = new Log(level)
  assert.equal(log.write('a'), 'info: a')
  assert.deepEqual(log.calls(), ['write'])
  // A new instance has its own state.
  const again = await mockImport(() => import('../src/log.ts'), [])
  assert.deepEqual(new again.Log(level).calls(), [])
  assert.equal(typeof require, 'undefined')
})
`,
    )
    const run = p.ubq()
    assert.deepEqual([run.err, run.out], ['', 'pass: 0 failed, 1 passed (run 1)\n'])
  })
}

test('a stuck test in compiled code has the place of the source, and convert keeps the names of CommonJS', () => {
  const p = transformProject('typescript', NEST)
  p.write(
    'src/spin.ts',
    `export enum Mode {
  On,
}
export class Spinner {
  constructor(private readonly mode: Mode) {}
  spin(): number {
    let n = 0
    while (this.mode === Mode.On) n++
    return n
  }
}
`,
  )
  p.write(
    'spec/spin.spec.ts',
    `import { assert, test } from 'ubqtest'
import { Mode, Spinner } from '../src/spin'
test('spins', { timeout: 100 }, () => {
  assert.equal(new Spinner(Mode.On).spin(), 0)
})
`,
  )
  p.write('spec/pass.spec.ts', "import { assert, test } from 'ubqtest'\ntest('passes', () => assert(true))\n")
  const lines = p.ubq().out.split('\n')
  // On Windows, Node gives no stack for a loop that does not return.
  if (process.platform !== 'win32')
    assert.deepEqual(
      lines.slice(
        lines.indexOf('FAIL spec/spin.spec.ts > spins') + 2,
        lines.indexOf('FAIL spec/spin.spec.ts > spins') + 4,
      ),
      ['  at src/spin.ts:8:5', '  > while (this.mode === Mode.On) n++'],
    )
  // The compiler makes CommonJS from this test file of jest: it
  // has `__dirname`, and an enum is not a problem.
  p.write(
    'spec/old.spec.ts',
    `import { join } from 'path'
enum Kind {
  A,
}
it('has a folder', () => {
  expect(join(__dirname, 'x')).toContain(Kind[Kind.A].toLowerCase().replace('a', 'x'))
})
`,
  )
  const report = p.ubq('convert', 'spec/old.spec.ts')
  assert.match(report.out, /^converted spec\/old\.spec\.ts \(jest\): 2 changes, 0 TODO$/m)
  assert.match(readFileSync(join(p.dir, 'spec/old.spec.ts'), 'utf8'), /assert\.contains\(join\(__dirname, 'x'\)/)
  assert.equal(p.ubq('spec/old.spec.ts').last, 'pass: 0 failed, 1 passed')
})

test('a project that does not have the compiler, and a typescript with no function for one file', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  const missing =
    'ubq: "transform": "swc" in the ubq configuration needs the package @swc/core, and the project does not have it. Install it as a devDependency.\n'
  p.configure({ transform: 'swc' })
  const run = p.ubq('pass.ts')
  assert.deepEqual([run.code, run.err], [4, missing])
  assert(p.ubq('doctor').out.includes(`FIX  ${missing.slice(5)}`))
  // TypeScript 7.
  symlinkSync(join(modules, 'typescript'), join(p.dir, 'node_modules/typescript'), 'junction')
  p.configure({ transform: 'typescript' })
  assert.match(
    p.ubq('pass.ts').err,
    /^ubq: "transform": "typescript" in the ubq configuration needs typescript 5 or 6\. The project has typescript 7\.\d+\.\d+, which has no function that compiles one file\. Use "transform": "swc", with the package @swc\/core\.\n$/,
  )
  assert.match(
    p.ubq('convert', '--transform=typescript').err,
    /^ubq: "transform": "typescript" in the ubq configuration needs typescript 5 or 6\./,
  )
  p.configure({ transform: 'babel' })
  assert.equal(p.ubq('pass.ts').err, 'ubq: "ubq.transform" in package.json must be "typescript" or "swc"\n')
})

test('ubq convert --transform sets the key, and installs swc with the package manager of the project', () => {
  const p = transformProject('typescript', NEST)
  // The indent of the file stays.
  p.write('package.json', '{\n\t"name": "x",\n\t"ubq": {\n\t\t"include": ["spec/**/*.spec.ts"]\n\t}\n}\n')
  p.write('src/kind.ts', 'export enum Kind {\n  A,\n}\n')
  p.write(
    'spec/kind.spec.ts',
    "import { assert, test } from 'ubqtest'\nimport { Kind } from '../src/kind'\ntest('kind', () => assert.equal(Kind.A, 0))\n",
  )
  // With no key, `ubq doctor` has the question for the user.
  assert.match(
    p.ubq('doctor').out,
    /^FIX  1 files have TypeScript syntax that Node cannot run .*: src\/kind\.ts\. .* Ask them to choose one of three\. \(1\) .* ubq convert --transform=typescript\. .* \(2\) .* ubq convert --transform=swc, .* \(3\) Run the tests on Bun /m,
  )
  const set = p.ubq('convert', '--transform=typescript')
  assert.deepEqual(
    [set.code, set.out.split('\n')[0]],
    [
      0,
      'ubq: package.json has "transform": "typescript" in "ubq". The typescript package of the project now makes the JavaScript of each TypeScript file, with the options of the tsconfig.json of its folder. Remove "erasableSyntaxOnly" from each tsconfig.',
    ],
  )
  assert.equal(
    readFileSync(join(p.dir, 'package.json'), 'utf8'),
    '{\n\t"name": "x",\n\t"ubq": {\n\t\t"include": [\n\t\t\t"spec/**/*.spec.ts"\n\t\t],\n\t\t"transform": "typescript"\n\t}\n}\n',
  )
  assert.equal(p.ubq().last, 'pass: 0 failed, 1 passed')
  const doctor = p.ubq('doctor').out
  assert.deepEqual([doctor.includes('ok   transform: typescript'), doctor.includes('Node cannot run')], [true, false])
  assert.equal(
    p.ubq('convert', '--transform').err,
    'ubq: --transform needs a compiler: --transform=typescript or --transform=swc\n',
  )

  // The command for each package manager.
  assert.deepEqual(addCommand(p.dir), ['npm', 'install', '--save-dev'])
  p.write('yarn.lock', '')
  assert.deepEqual(addCommand(join(p.dir, 'src')), ['yarn', 'add', '--dev'])
  rmSync(join(p.dir, 'yarn.lock'))
  p.write('bun.lock', '')
  assert.deepEqual(addCommand(p.dir), ['bun', 'add', '--dev'])
  rmSync(join(p.dir, 'bun.lock'))
  p.write('pnpm-lock.yaml', '')
  assert.deepEqual(addCommand(p.dir), ['pnpm', 'add', '--save-dev'])
  p.write('pnpm-workspace.yaml', '')
  assert.deepEqual(addCommand(p.dir), ['pnpm', 'add', '--save-dev', '-w'])
})

test(
  'ubq convert --transform=swc runs the install, and stops if it fails',
  { skip: process.platform === 'win32' && 'the package manager of this test is a shell script' },
  () => {
    const p = transformProject('typescript', NEST)
    // A package manager that puts a link to the package of this
    // repository in the project, as an install does.
    p.write(
      'bin/npm',
      `#!/bin/sh\necho "$@" > "${join(p.dir, 'npm-args.txt')}"\n[ -n "$FAIL" ] && exit 1\nln -s "${join(modules, '@swc')}" "${join(p.dir, 'node_modules/@swc')}"\n`,
    )
    chmodSync(join(p.dir, 'bin/npm'), 0o755)
    const setup = (more: Record<string, string> = {}) =>
      spawnSync('node', [cli, 'convert', '--transform=swc'], {
        cwd: p.dir,
        encoding: 'utf8',
        env: { ...process.env, ...more, PATH: `${join(p.dir, 'bin')}${delimiter}${process.env.PATH}` },
      })
    const failed = setup({ FAIL: '1' })
    assert.deepEqual(
      [failed.status, failed.stdout],
      [
        1,
        'ubq: npm install --save-dev @swc/core\nubq: the install of @swc/core failed. Run it yourself, and then run this command again: npm install --save-dev @swc/core\n',
      ],
    )
    assert(!readFileSync(join(p.dir, 'package.json'), 'utf8').includes('swc'))
    const done = setup()
    assert.deepEqual(
      [
        done.status,
        done.stdout
          .split('\n')
          .slice(0, 2)
          .map(line => line.slice(0, 54)),
      ],
      [0, ['ubq: npm install --save-dev @swc/core', 'ubq: package.json has "transform": "swc" in "ubq". The']],
    )
    assert.equal(readFileSync(join(p.dir, 'npm-args.txt'), 'utf8'), 'install --save-dev @swc/core\n')
    assert.equal(
      (JSON.parse(readFileSync(join(p.dir, 'package.json'), 'utf8')) as { ubq: { transform: string } }).ubq.transform,
      'swc',
    )
    // With the package, a second run installs nothing.
    rmSync(join(p.dir, 'npm-args.txt'))
    assert.deepEqual([setup().status, readdirSync(p.dir).includes('npm-args.txt')], [0, false])
  },
)

test('the options of a file are those of the tsconfig of its folder, or of the nearest folder above it', () => {
  const p = transformProject('typescript', {})
  const options = (file: string): unknown => {
    // A new transformer: it reads each config one time.
    const stamp = transformer(p.dir, 'typescript').stamp(join(p.dir, file))
    assert.match(stamp, /^typescript@5\.\d+\.\d+ \{/)
    return JSON.parse(stamp.slice(stamp.indexOf('{')))
  }
  const NONE = { legacy: false, metadata: false, define: false, verbatim: false, interop: true, commonjs: false }
  // No target: the class fields of TypeScript 5.
  assert.deepEqual(options('src/a.ts'), NONE)
  p.write('tsconfig.json', '{ not JSON')
  assert.deepEqual(options('src/a.ts'), NONE)
  rmSync(join(p.dir, 'tsconfig.json'))
  // No config: the code as Node runs it.
  assert.deepEqual(options('src/a.ts'), { ...NONE, define: true })
  p.write('base.json', JSON.stringify({ compilerOptions: { target: 'ESNext', experimentalDecorators: true } }))
  p.write(
    'tsconfig.json',
    JSON.stringify({ extends: './base', compilerOptions: { esModuleInterop: false, verbatimModuleSyntax: true } }),
  )
  assert.deepEqual(options('src/deep/a.ts'), { ...NONE, legacy: true, define: true, verbatim: true, interop: false })
  // The config of ubq is before the tsconfig.json of the same folder.
  p.write('src/tsconfig.json', JSON.stringify({ compilerOptions: { module: 'CommonJS' } }))
  assert.deepEqual(options('src/deep/a.ts'), { ...NONE, commonjs: true })
  p.write(
    'src/tsconfig.ubq.json',
    JSON.stringify({ compilerOptions: { target: 'es2022', useDefineForClassFields: false, module: 'NodeNext' } }),
  )
  // `nodenext`: the package says which module system a file has.
  assert.deepEqual(options('src/deep/a.ts'), { ...NONE, commonjs: true })
  const compiler = transformer(p.dir, 'typescript')
  assert.deepEqual(
    ['a.ts', 'a.mts', 'a.cts'].map(name => compiler.format(join(p.dir, 'src', name))),
    ['commonjs', 'module', 'commonjs'],
  )
  p.write('src/package.json', '{ "type": "module" }')
  assert.deepEqual(options('src/deep/a.ts'), NONE)
  rmSync(join(p.dir, 'src/package.json'))
  rmSync(join(p.dir, 'package.json'))
  assert.deepEqual(options('src/deep/a.ts'), { ...NONE, commonjs: true })
  assert.equal(
    p.ubq('convert', '--transform=swc').err,
    'ubq: ubq convert --transform needs a package.json: it sets the "transform" key there\n',
  )
})
