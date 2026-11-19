// Writes the benchmark suite: the same 20 test files for each test
// tool, in `suite/<tool>/test/`, with a copy of `src/`.
//   node gen.ts
// A test is a list of steps. Each tool has its own text for a step,
// in the form that a project with that tool has. The expected
// values come from the code of `src/`, when this program runs.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Cart } from './src/cart.ts'
import { chunk, deepMerge, groupBy, sortBy, unique } from './src/collection.ts'
import { clamp, gcd, mean, median, primes, round } from './src/math.ts'
import { formatDuration, parseDuration, parseQuery } from './src/parse.ts'
import { report, type Result } from './src/report.ts'
import { countWords, slugify, titleCase, truncate, wrap } from './src/text.ts'

const here = import.meta.dirname

type Step =
  | ['raw', string]
  | ['eq', string, unknown]
  | ['deep', string, unknown]
  | ['throws', string, string]
  | ['rejects', string, string]
  | ['match', string, string]
  | ['ok', string]
  // A spy with the name, and its implementation.
  | ['spy', string, string]
  | ['calls', string, number]
  | ['args', string, number, unknown]
  // Names of the module, the module, the dependency, and its mock.
  | ['mock', string, string, string, string]
  | ['clock']
  | ['tick', number]
  | ['snap', string]
  // A folder with files, with the name of its path.
  | ['dir', string, Record<string, string>]

interface Test {
  name: string
  async?: boolean
  steps: Step[]
}
interface File {
  name: string
  /** The import lines of the code under test. */
  imports: string[]
  groups: { name: string; tests: Test[] }[]
}

// --- The tests ---

/** The snapshots for a tool with no snapshots: the text is in the test file. */
const inline = new Map<string, string>()

// The same numbers in each run.
let seed = 42
const random = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}
const int = (max: number): number => Math.floor(random() * max)
const pick = <T>(list: T[]): T => list[int(list.length)]!
const WORDS = 'the quick brown fox jumps over a lazy dog and then runs home for tea with Zoë Ångström'.split(' ')
const words = (n: number): string => Array.from({ length: n }, () => pick(WORDS)).join(' ')
const numbers = (n: number): number[] => Array.from({ length: n }, () => int(200) - 50)
const lit = (value: unknown): string => JSON.stringify(value)

/** Tests of one function: `count` tests with `each` assertions. */
const cases = (label: string, count: number, each: number, step: (i: number) => Step): Test[] =>
  Array.from({ length: count }, (_, t) => ({
    name: `${label}, case ${t + 1}`,
    steps: Array.from({ length: each }, (_, i) => step(t * each + i)),
  }))

const unit = (
  name: string,
  imports: string,
  groups: [name: string, step: (i: number) => Step, error?: Step][],
): File => ({
  name,
  imports: [imports],
  groups: groups.map(([label, step, error]) => ({
    name: label,
    tests: [...cases(label, 7, 10, step), ...(error ? [{ name: `${label}, wrong input`, steps: [error] }] : [])],
  })),
})

const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, name: titleCase(words(2)), team: pick(['red', 'green', 'blue']) }))

const files: File[] = [
  unit('text-slug', "import { countWords, slugify, titleCase } from '../src/text.ts'", [
    ['slugify', () => ((text): Step => ['eq', `slugify(${lit(text)})`, slugify(text)])(words(1 + int(6)))],
    ['titleCase', () => ((text): Step => ['eq', `titleCase(${lit(text)})`, titleCase(text)])(words(1 + int(6)))],
    ['countWords', () => ((text): Step => ['eq', `countWords(${lit(text)})`, countWords(text)])(words(int(9)))],
  ]),
  unit('text-wrap', "import { truncate, wrap } from '../src/text.ts'", [
    [
      'wrap',
      () => ((text, width): Step => ['deep', `wrap(${lit(text)}, ${width})`, wrap(text, width)])(words(4 + int(12)), 8 + int(30)),
      ['throws', "() => wrap('a b', 0)", 'width must be 1 or more'],
    ],
    [
      'truncate',
      () => ((text, max): Step => ['eq', `truncate(${lit(text)}, ${max})`, truncate(text, max)])(words(1 + int(8)), 1 + int(40)),
      ['throws', "() => truncate('abc', 0)", 'max must be 1 or more'],
    ],
    ['wrap to one word', () => ((text): Step => ['eq', `wrap(${lit(text)}, 1).length`, wrap(text, 1).length])(words(1 + int(9)))],
  ]),
  unit('math-stats', "import { clamp, mean, median, round } from '../src/math.ts'", [
    [
      'mean',
      () => ((list): Step => ['eq', `round(mean(${lit(list)}), 3)`, round(mean(list), 3)])(numbers(1 + int(9))),
      ['throws', '() => mean([])', 'the list is empty'],
    ],
    [
      'median',
      () => ((list): Step => ['eq', `median(${lit(list)})`, median(list)])(numbers(1 + int(9))),
      ['throws', '() => median([])', 'the list is empty'],
    ],
    [
      'clamp',
      () => ((n, min): Step => ['eq', `clamp(${n}, ${min}, ${min + 20})`, clamp(n, min, min + 20)])(int(100) - 50, int(40) - 20),
      ['throws', '() => clamp(1, 5, 2)', 'min 5 is more than max 2'],
    ],
  ]),
  unit('math-primes', "import { gcd, primes } from '../src/math.ts'", [
    ['primes', i => ['deep', `primes(${10 + i})`, primes(10 + i)]],
    ['gcd', () => ((a, b): Step => ['eq', `gcd(${a}, ${b})`, gcd(a, b)])(int(5000), int(5000))],
    ['count of primes', i => ['eq', `primes(${500 + i * 37}).length`, primes(500 + i * 37).length]],
  ]),
  unit('parse-query', "import { parseQuery } from '../src/parse.ts'", [
    [
      'one value',
      () => ((key, value): Step => ['deep', `parseQuery(${lit(`?${key}=${value}`)})`, parseQuery(`?${key}=${value}`)])(pick(WORDS), int(999)),
    ],
    [
      'many values',
      () => ((query): Step => ['deep', `parseQuery(${lit(query)})`, parseQuery(query)])(
        Array.from({ length: 2 + int(5) }, () => `${pick(['a', 'b', 'tag', 'q'])}=${encodeURIComponent(words(1 + int(2)))}`).join('&'),
      ),
    ],
    ['the keys', () => ((query): Step => ['eq', `Object.keys(parseQuery(${lit(query)})).length`, Object.keys(parseQuery(query)).length])(Array.from({ length: 1 + int(6) }, () => `${pick(WORDS)}=1`).join('&'))],
  ]),
  unit('parse-duration', "import { formatDuration, parseDuration } from '../src/parse.ts'", [
    [
      'parseDuration',
      () => ((text): Step => ['eq', `parseDuration(${lit(text)})`, parseDuration(text)])(`${1 + int(23)}h${int(60)}m${int(60)}s`),
      ['throws', "() => parseDuration('soon')", 'not a duration: soon'],
    ],
    [
      'formatDuration',
      () => ((ms): Step => ['eq', `formatDuration(${ms})`, formatDuration(ms)])(int(400_000_000)),
      ['throws', '() => formatDuration(-1)', 'a duration is not negative'],
    ],
    ['there and back', () => ((ms): Step => ['eq', `parseDuration(formatDuration(${ms}))`, ms])(int(400_000_000))],
  ]),
  unit('collection-group', "import { chunk, groupBy, sortBy, unique } from '../src/collection.ts'", [
    [
      'chunk',
      () => ((list, size): Step => ['deep', `chunk(${lit(list)}, ${size})`, chunk(list, size)])(numbers(int(12)), 1 + int(5)),
      ['throws', '() => chunk([1], 0)', 'size must be 1 or more'],
    ],
    ['unique', () => ((list): Step => ['deep', `unique(${lit(list)})`, unique(list)])(Array.from({ length: int(14) }, () => int(6)))],
    [
      'groupBy and sortBy',
      () =>
        ((list): Step => [
          'deep',
          `groupBy(sortBy(${lit(list)}, item => item.name), item => item.team)`,
          groupBy(sortBy(list, item => item.name), item => item.team),
        ])(people(2 + int(5))),
    ],
  ]),
  unit('collection-merge', "import { deepMerge } from '../src/collection.ts'", [
    ...(['flat', 'nested', 'lists'] as const).map((kind): [string, (i: number) => Step] => [
      `deepMerge, ${kind}`,
      () => {
        const value = (depth: number): unknown =>
          kind === 'lists' ? numbers(int(4)) : depth && kind === 'nested' && random() < 0.5 ? object(depth - 1) : int(100)
        const object = (depth: number): Record<string, unknown> =>
          Object.fromEntries(Array.from({ length: 1 + int(4) }, () => [pick(['a', 'b', 'c', 'd', 'e']), value(depth)]))
        const [a, b] = [object(2), object(2)]
        return ['deep', `deepMerge(${lit(a)}, ${lit(b)})`, deepMerge(a, b)]
      },
    ]),
  ]),
  {
    name: 'cart',
    imports: ["import { Cart } from '../src/cart.ts'"],
    groups: ['a small cart', 'a discount', 'changes'].map((label, g) => ({
      name: label,
      tests: Array.from({ length: 8 }, (_, t) => {
        const cart = new Cart()
        const steps: Step[] = [['raw', 'const cart = new Cart()']]
        for (let i = 0; i < 3 + int(4); i++) {
          const [sku, price, count] = [`sku-${int(5)}`, 100 + int(900), g === 1 ? 3 + int(4) : 1 + int(2)]
          cart.add(sku, price, count)
          steps.push(['raw', `cart.add(${lit(sku)}, ${price}, ${count})`], ['eq', 'cart.count', cart.count])
        }
        if (g === 2) {
          const sku = cart.lines[0]!.sku
          cart.remove(sku)
          steps.push(['raw', `cart.remove(${lit(sku)})`], ['throws', `() => cart.remove(${lit(sku)})`, `the cart has no ${sku}`])
        }
        steps.push(['eq', 'cart.total()', cart.total()], ['deep', 'cart.lines', cart.lines])
        if (t === 0) steps.push(['throws', "() => cart.add('x', 1, 0)", 'the count must be a whole number'])
        return { name: `${label}, case ${t + 1}`, steps }
      }),
    })),
  },
  {
    name: 'async-retry',
    imports: ["import { delay, retry } from '../src/async.ts'"],
    groups: [
      {
        name: 'retry',
        tests: Array.from({ length: 10 }, (_, t) => ({
          name: `passes at attempt ${(t % 4) + 1}, case ${t + 1}`,
          async: true,
          steps: [
            ['raw', 'const seen: number[] = []'],
            [
              'raw',
              `const result = await retry(async attempt => {\n  seen.push(attempt)\n  await delay(1)\n  if (attempt < ${(t % 4) + 1}) throw new Error('not yet')\n  return attempt * ${t + 2}\n}, 5)`,
            ],
            ['eq', 'result', ((t % 4) + 1) * (t + 2)],
            ['deep', 'seen', Array.from({ length: (t % 4) + 1 }, (_, i) => i + 1)],
            ['rejects', `retry(async () => {\n  throw new Error('never ${t}')\n}, 2)`, `never ${t}`],
            ['eq', `await delay(1, ${t})`, t],
          ] satisfies Step[],
        })),
      },
    ],
  },
  {
    name: 'async-map',
    imports: ["import { delay, mapLimit } from '../src/async.ts'"],
    groups: [
      {
        name: 'mapLimit',
        tests: Array.from({ length: 10 }, (_, t) => {
          const items = numbers(4 + int(6))
          const limit = 1 + (t % 4)
          return {
            name: `limit ${limit}, case ${t + 1}`,
            async: true,
            steps: [
              ['raw', 'let now = 0\nlet most = 0'],
              [
                'raw',
                `const out = await mapLimit(${lit(items)}, ${limit}, async n => {\n  most = Math.max(most, ++now)\n  await delay(1)\n  now--\n  return n * 2\n})`,
              ],
              ['deep', 'out', items.map(n => n * 2)],
              ['eq', 'most', Math.min(limit, items.length)],
              ['eq', 'now', 0],
              ['deep', 'await mapLimit([], 3, async n => n)', []],
              ['rejects', `mapLimit([1], 1, async () => {\n  throw new Error('item ${t}')\n})`, `item ${t}`],
            ] satisfies Step[],
          }
        }),
      },
    ],
  },
  {
    name: 'async-timeout',
    imports: ["import { delay, withTimeout } from '../src/async.ts'"],
    groups: [
      {
        name: 'withTimeout',
        tests: Array.from({ length: 10 }, (_, t) => ({
          name: `case ${t + 1}`,
          async: true,
          steps: [
            ['eq', `await withTimeout(delay(1, ${lit(`v${t}`)}), 50)`, `v${t}`],
            ['rejects', 'withTimeout(delay(30), 2)', 'no result in 2 ms'],
            ['rejects', `withTimeout(Promise.reject(new Error('lost ${t}')), 50)`, `lost ${t}`],
            ['deep', `await Promise.all([withTimeout(delay(2, 1), 50), withTimeout(delay(1, 2), 50)])`, [1, 2]],
            ['ok', '(await withTimeout(Promise.resolve(true), 1)) === true'],
          ] satisfies Step[],
        })),
      },
    ],
  },
  {
    name: 'spies-events',
    imports: ["import { Emitter } from '../src/events.ts'"],
    groups: [
      {
        name: 'Emitter',
        tests: Array.from({ length: 12 }, (_, t) => {
          const values = numbers(2 + (t % 4))
          return {
            name: `on, once, and off, case ${t + 1}`,
            steps: [
              ['raw', 'const emitter = new Emitter<number>()'],
              ['spy', 'each', '(value: number) => value'],
              ['spy', 'first', '(value: number) => value'],
              ['raw', 'const off = emitter.on(each)\nemitter.once(first)'],
              ...values.map((value): Step => ['raw', `emitter.emit(${value})`]),
              ['calls', 'each', values.length],
              ['calls', 'first', 1],
              ['args', 'each', values.length - 1, [values.at(-1)]],
              ['args', 'first', 0, [values[0]]],
              ['raw', 'off()'],
              ['eq', 'emitter.emit(0)', 0],
              ['calls', 'each', values.length],
            ] satisfies Step[],
          }
        }),
      },
    ],
  },
  {
    name: 'spies-callbacks',
    imports: ["import { each, pipe } from '../src/events.ts'"],
    groups: [
      {
        name: 'each and pipe',
        tests: Array.from({ length: 12 }, (_, t) => {
          const list = Array.from({ length: 2 + (t % 5) }, () => pick(WORDS))
          return {
            name: `case ${t + 1}`,
            steps: [
              ['spy', 'seen', '(item: string, index: number) => item.length + index'],
              ['raw', `each(${lit(list)}, seen)`],
              ['calls', 'seen', list.length],
              ['args', 'seen', 0, [list[0], 0]],
              ['args', 'seen', list.length - 1, [list.at(-1), list.length - 1]],
              ['spy', 'double', '(n: number) => n * 2'],
              ['spy', 'add', `(n: number) => n + ${t}`],
              ['eq', `pipe(double, add, double)(${t + 1})`, ((t + 1) * 2 + t) * 2],
              ['calls', 'double', 2],
              ['args', 'add', 0, [(t + 1) * 2]],
            ] satisfies Step[],
          }
        }),
      },
    ],
  },
  ...(['greeting', 'rename and welcome'] as const).map(
    (kind, k): File => ({
      name: k ? 'mock-rename' : 'mock-greeting',
      imports: [],
      groups: [
        {
          name: kind,
          tests: Array.from({ length: 8 }, (_, t) => {
            const user = { id: t + 1, name: titleCase(words(2)), email: `${slugify(words(1))}${t}@example.com` }
            const db = `{ fetchUser: async (id: number) => (id === ${user.id} ? ${lit(user)} : undefined), saveUser: async () => {} }`
            return {
              name: `case ${t + 1}`,
              async: true,
              steps: (k
                ? [
                    ['mock', '{ rename }', '../src/users.ts', '../src/db.ts', db],
                    ['deep', `await rename(${user.id}, '  New Name ')`, { ...user, name: 'New Name' }],
                    ['rejects', 'rename(999, "x")', 'no user 999'],
                    ['mock', '{ welcome }', '../src/users.ts', '../src/mailer.ts', `{ send: async (to: string, subject: string) => to + ': ' + subject }`],
                    ['rejects', `welcome(${user.id})`, 'no database in a test'],
                  ]
                : [
                    ['mock', '{ greeting }', '../src/users.ts', '../src/db.ts', db],
                    ['eq', `await greeting(${user.id})`, `Hello, ${user.name}`],
                    ['eq', 'await greeting(999)', 'Hello, guest'],
                    ['match', `await greeting(${user.id})`, '^Hello, '],
                    ['ok', `(await greeting(${user.id})).length > 7`],
                  ]) satisfies Step[],
            }
          }),
        },
      ],
    }),
  ),
  {
    name: 'timers',
    imports: ["import { debounce, poll, stamp } from '../src/scheduler.ts'"],
    groups: [
      {
        name: 'debounce and poll',
        tests: Array.from({ length: 10 }, (_, t) => {
          const ms = 100 * (t + 1)
          return {
            name: `${ms} ms, case ${t + 1}`,
            async: true,
            steps: [
              ['clock'],
              ['spy', 'fn', '(value: string) => value'],
              ['raw', `const later = debounce(fn, ${ms})\nlater('a')\nlater('b')`],
              ['tick', ms - 1],
              ['calls', 'fn', 0],
              ['tick', 1],
              ['calls', 'fn', 1],
              ['args', 'fn', 0, ['b']],
              ['raw', `let count = 0\nconst stop = poll(() => ++count === 3, ${ms})`],
              ['tick', ms * 5],
              ['eq', 'count', 3],
              ['raw', 'stop()'],
              ['match', 'stamp()', '^\\d{4}-\\d\\d-\\d\\dT'],
            ] satisfies Step[],
          }
        }),
      },
    ],
  },
  {
    name: 'snapshot',
    imports: ["import { report } from '../src/report.ts'"],
    groups: [
      {
        name: 'report',
        tests: Array.from({ length: 12 }, (_, t) => {
          const results: Result[] = Array.from({ length: 2 + (t % 6) }, () => ({
            name: slugify(words(1 + int(3))),
            ms: int(90_000),
            status: pick(['pass', 'pass', 'pass', 'fail', 'skip']),
          }))
          inline.set(`case ${t + 1}`, report(`Run ${t + 1}`, results))
          return {
            name: `case ${t + 1}`,
            steps: [
              ['raw', `const text = report(${lit(`Run ${t + 1}`)}, ${lit(results)})`],
              ['snap', 'text'],
              ['eq', "text.split('\\n').length", report(`Run ${t + 1}`, results).split('\n').length],
              ['match', 'text', `^# Run ${t + 1}\\n`],
            ] satisfies Step[],
          }
        }),
      },
    ],
  },
  {
    name: 'files',
    imports: ["import { readJson, totalSize, walk, writeText } from '../src/files.ts'", "import { readFileSync } from 'node:fs'", "import { join } from 'node:path'"],
    groups: [
      {
        name: 'a folder of files',
        tests: Array.from({ length: 8 }, (_, t) => {
          const tree: Record<string, string> = { 'package.json': lit({ name: `p${t}`, version: `1.${t}.0` }) }
          for (let i = 0; i < 2 + (t % 4); i++) tree[`src/${pick(['a', 'b', 'lib/c', 'lib/d', 'e'])}${i}.txt`] = words(1 + int(8))
          const names = Object.keys(tree).sort()
          return {
            name: `case ${t + 1}`,
            steps: [
              ['dir', 'dir', tree],
              ['deep', 'walk(dir)', names],
              ['eq', "readJson<{ version: string }>(join(dir, 'package.json')).version", `1.${t}.0`],
              ['eq', 'totalSize(dir)', Object.values(tree).reduce((sum, text) => sum + Buffer.byteLength(text), 0)],
              ['raw', "writeText(join(dir, 'out/report.txt'), 'done')"],
              ['eq', "readFileSync(join(dir, 'out/report.txt'), 'utf8')", 'done'],
              ['eq', 'walk(dir).length', names.length + 1],
            ] satisfies Step[],
          }
        }),
      },
    ],
  },
  {
    name: 'child',
    imports: ["import { spawnSync } from 'node:child_process'"],
    groups: [
      {
        name: 'the command',
        tests: (
          [
            ['mean', ['2', '4', '9'], '5\n', 0],
            ['gcd', ['12', '18', '30'], '6\n', 0],
            ['slug', ['Hello', 'World'], 'hello-world\n', 0],
            ['mean', ['10'], '10\n', 0],
            ['nope', [], '', 2],
            ['slug', ['Zoë', 'Ångström'], 'zoe-angstrom\n', 0],
          ] as const
        ).map(([command, args, out, code], t) => ({
          name: `${command}, case ${t + 1}`,
          steps: [
            [
              'raw',
              `const run = spawnSync(process.execPath, [new URL('../src/cli.ts', import.meta.url).pathname, ${lit(command)}, ...${lit(args)}], { encoding: 'utf8' })`,
            ],
            ['eq', 'run.status', code],
            ['eq', 'run.stdout', out],
            code ? ['match', 'run.stderr', `unknown command: ${command}`] : ['eq', 'run.stderr', ''],
          ] satisfies Step[],
        })),
      },
    ],
  },
]

// --- The text of each tool ---

interface Tool {
  /** The import lines, for the kinds of steps that the file has. */
  head(kinds: Set<string>): string[]
  /** The lines of a step. `t` is the test object of tape and of ava. */
  step(step: Step, test: Test): string[]
  test(name: string, body: string[], test: Test): string[]
  /** False for a tool with no groups: the name of the group goes into the name of the test. */
  group?(name: string, body: string[]): string[]
}

const indent = (lines: string[]): string[] => lines.flatMap(line => line.split('\n')).map(line => (line ? `  ${line}` : line))
const regex = (source: string): string => `/${source.replace(/\//g, '\\/')}/`
/** A text as a RegExp that the text matches. */
const text = (message: string): string => regex(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
const tmp = (name: string, tree: Record<string, string>): string[] => [
  `const ${name} = mkdtempSync(join(tmpdir(), 'bench-'))`,
  `for (const [file, content] of Object.entries(${lit(tree)})) {`,
  `  mkdirSync(dirname(join(${name}, file)), { recursive: true })`,
  `  writeFileSync(join(${name}, file), content)`,
  '}',
]
const TMP = ["import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'", "import { tmpdir } from 'node:os'", "import { dirname } from 'node:path'"]

// tape and ava have a test object with almost the same methods.
const onT = (names: { eq: string; deep: string; match: string; ok: string }) => (step: Step): string[] | undefined => {
  const [kind, a, b] = step
  if (kind === 'eq') return [`t.${names.eq}(${a}, ${lit(b)})`]
  if (kind === 'deep') return [`t.${names.deep}(${a}, ${lit(b)})`]
  if (kind === 'throws') return [`t.throws(${a}, ${text(b as string)})`]
  if (kind === 'match') return [`t.${names.match}(${a}, ${regex(b as string)})`]
  if (kind === 'ok') return [`t.${names.ok}(${a})`]
  return undefined
}
// sinon, for the tools with no spies and no clock of their own.
const sinonStep = (step: Step, eq: (a: string, b: unknown) => string, deep: (a: string, b: unknown) => string, end: (code: string) => string): string[] | undefined => {
  const [kind, a, b, c] = step
  if (kind === 'spy') return [`const ${a} = sinon.spy(${b})`]
  if (kind === 'calls') return [eq(`${a}.callCount`, b)]
  if (kind === 'args') return [deep(`${a}.args[${b}]`, c)]
  if (kind === 'clock') return ['const clock = sinon.useFakeTimers()', end('clock.restore()')]
  if (kind === 'tick') return [`clock.tick(${a})`]
  if (kind === 'mock') return [`const ${a} = await esmock(${lit(b)}, { ${lit(c)}: ${step[4]} })`]
  return undefined
}

const tools: Record<string, Tool> = {
  ubq: {
    head: kinds => [
      `import { ${['assert', 'describe', kinds.has('clock') && 'fakeClock', kinds.has('mock') && 'mockImport', kinds.has('spy') && 'spy', 'test', kinds.has('dir') && 'testdir'].filter(Boolean).join(', ')} } from 'ubqtest'`,
    ],
    step: ([kind, a, b, c, d]) =>
      kind === 'raw'
        ? [a]
        : kind === 'eq'
          ? [`assert.equal(${a}, ${lit(b)})`]
          : kind === 'deep'
            ? [`assert.deepEqual(${a}, ${lit(b)})`]
            : kind === 'throws'
              ? [`assert.throws(${a}, ${text(b as string)})`]
              : kind === 'rejects'
                ? [`await assert.rejects(${a}, ${text(b as string)})`]
                : kind === 'match'
                  ? [`assert.match(${a}, ${regex(b as string)})`]
                  : kind === 'ok'
                    ? [`assert(${a})`]
                    : kind === 'spy'
                      ? [`const ${a} = spy(${b})`]
                      : kind === 'calls'
                        ? [`assert.equal(${a}.calls.length, ${b})`]
                        : kind === 'args'
                          ? [`assert.deepEqual(${a}.calls[${b}]?.args, ${lit(c)})`]
                          : kind === 'mock'
                            ? [`const ${a} = await mockImport(() => import(${lit(b)}), [[() => import(${lit(c)}), ${d}]])`]
                            : kind === 'clock'
                              ? ['const clock = fakeClock()']
                              : kind === 'tick'
                                ? [`await clock.tick(${a})`]
                                : kind === 'snap'
                                  ? [`assert.snapshot(${a})`]
                                  : [`const ${a} = testdir(${lit(b)})`],
    test: (name, body, test) => [`test(${lit(name)}, ${test.async ? 'async ' : ''}() => {`, ...indent(body), '})'],
    group: (name, body) => [`describe(${lit(name)}, () => {`, ...indent(body), '})'],
  },
  vitest: {
    head: kinds => [
      `import { ${['describe', 'expect', (kinds.has('dir') || kinds.has('clock')) && 'onTestFinished', 'test', (kinds.has('spy') || kinds.has('clock') || kinds.has('mock')) && 'vi'].filter(Boolean).join(', ')} } from 'vitest'`,
      ...(kinds.has('dir') ? TMP : []),
    ],
    step: ([kind, a, b, c, d]) =>
      kind === 'raw'
        ? [a]
        : kind === 'eq'
          ? [`expect(${a}).toBe(${lit(b)})`]
          : kind === 'deep'
            ? [`expect(${a}).toEqual(${lit(b)})`]
            : kind === 'throws'
              ? [`expect(${a}).toThrow(${text(b as string)})`]
              : kind === 'rejects'
                ? [`await expect(${a}).rejects.toThrow(${text(b as string)})`]
                : kind === 'match'
                  ? [`expect(${a}).toMatch(${regex(b as string)})`]
                  : kind === 'ok'
                    ? [`expect(${a}).toBeTruthy()`]
                    : kind === 'spy'
                      ? [`const ${a} = vi.fn(${b})`]
                      : kind === 'calls'
                        ? [`expect(${a}).toHaveBeenCalledTimes(${b})`]
                        : kind === 'args'
                          ? [`expect(${a}.mock.calls[${b}]).toEqual(${lit(c)})`]
                          : kind === 'mock'
                            ? ['vi.resetModules()', `vi.doMock(${lit(c)}, () => (${d}))`, `const ${a} = await import(${lit(b)})`, `vi.doUnmock(${lit(c)})`]
                            : kind === 'clock'
                              ? ['vi.useFakeTimers()', 'onTestFinished(() => void vi.useRealTimers())']
                              : kind === 'tick'
                                ? [`vi.advanceTimersByTime(${a})`]
                                : kind === 'snap'
                                  ? [`expect(${a}).toMatchSnapshot()`]
                                  : [...tmp(a, b as Record<string, string>), `onTestFinished(() => rmSync(${a}, { recursive: true }))`],
    test: (name, body, test) => [`test(${lit(name)}, ${test.async ? 'async ' : ''}() => {`, ...indent(body), '})'],
    group: (name, body) => [`describe(${lit(name)}, () => {`, ...indent(body), '})'],
  },
  ava: {
    head: kinds => [
      "import test from 'ava'",
      ...(kinds.has('spy') || kinds.has('clock') ? ["import sinon from 'sinon'"] : []),
      ...(kinds.has('mock') ? ["import esmock from 'esmock'"] : []),
      ...(kinds.has('dir') ? TMP : []),
    ],
    step: step =>
      step[0] === 'raw'
        ? [step[1]]
        : step[0] === 'throws'
          ? [`t.throws(${step[1]}, { message: ${text(step[2])} })`]
          : (onT({ eq: 'is', deep: 'deepEqual', match: 'regex', ok: 'truthy' })(step) ??
            (step[0] === 'rejects'
              ? [`await t.throwsAsync(${step[1]}, { message: ${text(step[2])} })`]
              : step[0] === 'snap'
                ? [`t.snapshot(${step[1]})`]
                : step[0] === 'dir'
                  ? [...tmp(step[1], step[2]), `t.teardown(() => rmSync(${step[1]}, { recursive: true }))`]
                  : sinonStep(
                      step,
                      (a, b) => `t.is(${a}, ${lit(b)})`,
                      (a, b) => `t.deepEqual(${a}, ${lit(b)})`,
                      code => `t.teardown(() => ${code})`,
                    )!)),
    // The tests of an ava file run at the same time. A test with a
    // clock for all timers must run alone.
    test: (name, body, test) => [
      `test${test.steps.some(step => step[0] === 'clock') ? '.serial' : ''}(${lit(name)}, ${test.async ? 'async ' : ''}t => {`,
      ...indent(body),
      '})',
    ],
  },
  tape: {
    head: kinds => [
      "import test from 'tape'",
      ...(kinds.has('spy') || kinds.has('clock') ? ["import sinon from 'sinon'"] : []),
      ...(kinds.has('mock') ? ["import esmock from 'esmock'"] : []),
      ...(kinds.has('dir') ? TMP : []),
    ],
    step: (step, test) =>
      step[0] === 'raw'
        ? [step[1]]
        : (onT({ eq: 'equal', deep: 'deepEqual', match: 'match', ok: 'ok' })(step) ??
          (step[0] === 'rejects'
            ? [`await ${step[1]}.then(\n  () => t.fail('no error'),\n  (error: Error) => t.match(error.message, ${text(step[2])}),\n)`]
            : step[0] === 'snap'
              ? [`t.equal(${step[1]}, ${lit(inline.get(test.name))})`]
              : step[0] === 'dir'
                ? [...tmp(step[1], step[2]), `t.teardown(() => rmSync(${step[1]}, { recursive: true }))`]
                : sinonStep(
                    step,
                    (a, b) => `t.equal(${a}, ${lit(b)})`,
                    (a, b) => `t.deepEqual(${a}, ${lit(b)})`,
                    code => `t.teardown(() => ${code})`,
                  )!)),
    test: (name, body, test) => [`test(${lit(name)}, ${test.async ? 'async ' : ''}t => {`, ...indent(body), ...(test.async ? [] : ['  t.end()']), '})'],
  },
  mocha: {
    head: kinds => [
      "import assert from 'node:assert/strict'",
      ...(kinds.has('spy') || kinds.has('clock') ? ["import sinon from 'sinon'"] : []),
      ...(kinds.has('mock') ? ["import esmock from 'esmock'"] : []),
      ...(kinds.has('dir') ? TMP : []),
    ],
    step: (step, test) => {
      const [kind, a, b] = step
      return kind === 'raw'
        ? [a]
        : kind === 'eq'
          ? [`assert.equal(${a}, ${lit(b)})`]
          : kind === 'deep'
            ? [`assert.deepEqual(${a}, ${lit(b)})`]
            : kind === 'throws'
              ? [`assert.throws(${a}, ${text(b)})`]
              : kind === 'rejects'
                ? [`await assert.rejects(${a}, ${text(b)})`]
                : kind === 'match'
                  ? [`assert.match(${a}, ${regex(b)})`]
                  : kind === 'ok'
                    ? [`assert.ok(${a})`]
                    : kind === 'snap'
                      ? [`assert.equal(${a}, ${lit(inline.get(test.name))})`]
                      : kind === 'dir'
                        ? [...tmp(a, b), `cleanups.push(() => rmSync(${a}, { recursive: true }))`]
                        : sinonStep(
                            step,
                            (x, y) => `assert.equal(${x}, ${lit(y)})`,
                            (x, y) => `assert.deepEqual(${x}, ${lit(y)})`,
                            code => `cleanups.push(() => ${code})`,
                          )!
    },
    test: (name, body, test) => [`it(${lit(name)}, ${test.async ? 'async ' : ''}() => {`, ...indent(body), '})'],
    group: (name, body) => [`describe(${lit(name)}, () => {`, ...indent(body), '})'],
  },
}

// --- The files ---

/** The config files of each tool: the tests, and TypeScript files as they are. */
const configs: Record<string, Record<string, unknown>> = {
  // A second copy of the project, in `suite/ubq-types`, has this
  // file: ubq then also runs the type checker.
  ubq: {},
  vitest: { 'vitest.config.ts': "export default { test: { include: ['test/*.test.ts'] } }\n" },
  ava: { 'package.json': { type: 'module', private: true, ava: { files: ['test/*.test.ts'], extensions: ['ts'] } } },
  // The command of tape loads a file with `require`, which cannot
  // load a module that waits at its top level, as esmock does.
  tape: { 'all.mjs': 'for (const file of process.argv.slice(2)) await import(new URL(file, import.meta.url).href)\n' },
  mocha: { '.mocharc.json': { spec: 'test/*.test.ts', extension: ['ts'] } },
}
const TSCONFIG = {
  compilerOptions: {
    target: 'esnext',
    module: 'nodenext',
    strict: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    erasableSyntaxOnly: true,
    skipLibCheck: true,
    types: ['node'],
  },
  include: ['src', 'test'],
}

let assertions = 0
let count = 0
for (const [toolName, tool] of Object.entries(tools)) {
  const dir = join(here, 'suite', toolName)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'test'), { recursive: true })
  cpSync(join(here, 'src'), join(dir, 'src'), { recursive: true })
  for (const [name, content] of Object.entries({ 'package.json': { type: 'module', private: true }, ...configs[toolName] }))
    writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n')
  for (const file of files) {
    const kinds = new Set(file.groups.flatMap(group => group.tests.flatMap(test => test.steps.map(step => step[0]))))
    const body = file.groups.flatMap(group => {
      const tests = group.tests.flatMap(test => {
        const name = tool.group ? test.name : `${group.name}: ${test.name}`
        if (toolName === 'ubq') {
          count++
          assertions += test.steps.filter(step => !/^(raw|spy|mock|clock|tick|dir)$/.test(step[0])).length
        }
        return tool.test(
          name,
          test.steps.flatMap(step => tool.step(step, test)),
          test,
        )
      })
      return tool.group ? tool.group(group.name, tests) : tests
    })
    const mocha = toolName === 'mocha' && (kinds.has('clock') || kinds.has('dir'))
    writeFileSync(
      join(dir, 'test', `${file.name}.test.ts`),
      [
        ...tool.head(kinds),
        ...file.imports,
        '',
        // mocha has no function that runs at the end of one test.
        ...(mocha ? ['const cleanups: (() => void)[] = []', 'afterEach(() => {', '  for (const fn of cleanups.splice(0)) fn()', '})', ''] : []),
        ...body,
        '',
      ].join('\n'),
    )
  }
}
// ubq with the type checker of the project.
rmSync(join(here, 'suite/ubq-types'), { recursive: true, force: true })
cpSync(join(here, 'suite/ubq'), join(here, 'suite/ubq-types'), { recursive: true })
writeFileSync(join(here, 'suite/ubq-types/tsconfig.json'), JSON.stringify(TSCONFIG, null, 2) + '\n')
console.log(`${files.length} test files, ${count} tests, ${assertions} assertions, for ${Object.keys(tools).join(', ')}`)
