// Fixture projects import `ubqtest` as a real project does: through
// `node_modules`. This makes the link to the repository root.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))

// A relative link, so that it stays correct if the repository moves.
const link = `${fixtures}node_modules/ubqtest`
const target = '../../..'
const current = (): string | undefined => {
  try {
    return readlinkSync(link)
  } catch {
    return undefined
  }
}
mkdirSync(`${fixtures}node_modules`, { recursive: true })
if (current() !== target) {
  try {
    rmSync(link, { force: true })
    symlinkSync(target, link)
  } catch (error) {
    // Test files run in parallel, and each one loads this module.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/** Removes the run store of a fixture project. */
export const resetStore = (project: string): void =>
  rmSync(`${project}.ubq`, { recursive: true, force: true })

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

/**
 * A new project in a temporary folder, so that its store has only
 * the runs of one test. `flip.ts` fails if `set('fail')` ran last.
 */
export const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ubq-project-'))
  const configure = (ubq?: unknown) =>
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', ubq }))
  configure()
  for (const f of ['empty.ts', 'fail.ts', 'fix.ts', 'flip.ts', 'load-error.ts', 'leak.ts', 'mock.ts', 'pass.ts', 'snap.ts', 'sometimes.ts', 'src']) cpSync(`${fixtures}${f}`, join(dir, f), { recursive: true })
  mkdirSync(join(dir, 'node_modules'))
  symlinkSync(fileURLToPath(new URL('..', import.meta.url)), join(dir, 'node_modules/ubqtest'))
  const flip = join(dir, 'flip.txt')
  const ubq = (...args: string[]) => {
    const r = spawnSync('node', [cli, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, CI: '', FLIP_FILE: flip } })
    return { code: r.status, last: r.stdout.replace(/ \(run \d+\)\n$/, '').split('\n').at(-1), err: r.stderr, out: r.stdout }
  }
  return { dir, ubq, configure, set: (v: string) => writeFileSync(flip, v) }
}

/**
 * Adds a JSX component (`src/view.tsx`) and its test file
 * (`view.tsx`) to a project. Bun and Deno can run them.
 */
export const addJsx = (dir: string): void => {
  writeFileSync(
    join(dir, 'src/view.tsx'),
    `// Deno makes calls to this name. Bun imports the functions of React.
const React = { createElement: (type: unknown, props: unknown) => ({ type, props }) }
void React

export const many = (n: number): boolean => n > 2

export function View({ items }: { items: string[] }) {
  const size = many(items.length) ? <b>many</b> : <i>few</i>
  return (
    <div className="view">
      {size}
      {items.length > 0 && <ul>{items.map(i => <li key={i}>{i}</li>)}</ul>}
    </div>
  )
}

export const Never = <T,>({ value }: { value: T }) => <i>{String(value)}</i>
`,
  )
  writeFileSync(
    join(dir, 'view.tsx'),
    `import { assert, test } from 'ubqtest'
import { many, View } from './src/view.tsx'

const shape = (v: unknown) => JSON.stringify(v)

test('a view of no items', () => {
  assert.match(shape(View({ items: [] })), /"view"/)
})
test('many is more than two', () => {
  assert.deepEqual([many(2), many(3)], [false, true])
})
test('a view of two items', () => {
  assert.match(shape(View({ items: ['a', 'b'] })), /"view"/)
})
`,
  )
  const react = join(dir, 'node_modules/react')
  mkdirSync(react)
  writeFileSync(join(react, 'package.json'), '{"type":"module","exports":{"./jsx-dev-runtime":"./jsx.js","./jsx-runtime":"./jsx.js"}}')
  writeFileSync(
    join(react, 'jsx.js'),
    'export const jsxDEV = (type, props) => ({ type, props })\nexport const jsx = jsxDEV\nexport const jsxs = jsxDEV\nexport const Fragment = "f"\n',
  )
}

