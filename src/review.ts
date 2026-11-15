// `ubq review`: the changes to the tests that a person must look at
// (D68). An agent that must make tests pass can remove a test, skip
// it, remove its assertions, or change an expected value to the
// value that the code now gives. Each is easy to miss in a large
// diff. This command reads the diff, the test files at the base
// commit and now, and the coverage of the store.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { isBuild, isHelper, UsageError } from './config.ts'
import { changedLines, diffOption } from './git.ts'
import type { Node } from './instrument.ts'
import { projectRoot } from './project.ts'
import { stale, testFiles, testsOfLines } from './query.ts'
import { snapshotEntries } from './snapshot.ts'
import { openStore } from './store.ts'

// The source is `.ts`, and the bundle is `.js`.
const INSTRUMENT = import.meta.url.endsWith('.ts') ? './instrument.ts' : './instrument.js'

/** A file that can have code. */
const CODE = /\.([cm]?[jt]s|[jt]sx)$/
const SNAPSHOT = /^ubq-snapshots\/(.+)\.snap$/
/** The most lines of one kind that an item shows. */
const SHOWN = 3

/** A test, as the source of its file defines it. */
interface Defined {
  line: number
  /** The reason of `skip`, or the source of its condition. */
  skip?: string
  /** The source of each assertion call, with its space made one space. */
  asserts: string[]
  /** The source of the test function, for a test with a new name. */
  body: string
}

const git = (...args: string[]): { ok: boolean; out: string } => {
  const { spawnSync } = process.getBuiltinModule('node:child_process')
  const r = spawnSync('git', args, { cwd: projectRoot(), encoding: 'utf8', maxBuffer: 1 << 28 })
  // ubq: not measured: git is on the path in each test
  if (r.error) throw new UsageError(`ubq review needs git: ${r.error.message}`)
  return { ok: r.status === 0, out: r.stdout }
}

/** The text of a file at a commit. The diff names only files that the commit has. */
const atCommit = (commit: string, file: string): string => git('show', `${commit}:./${file}`).out

/** The text of a file now. The diff names only files that are there. */
const now = (file: string): string => readFileSync(join(projectRoot(), file), 'utf8')

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * The tests that a test file defines, by test ID, and the text of
 * its comments. Only tests with a name that is plain text, in groups
 * with such names: the ID of a name with `${}` is not known before
 * the file runs.
 */
const parsed = (file: string, source: string): { tests: Map<string, Defined>; comments: string[] } => {
  const out = new Map<string, Defined>()
  const comments: string[] = []
  const { parse, children } = createRequire(import.meta.url)(INSTRUMENT) as typeof import('./instrument.ts')
  let tree: Node
  try {
    tree = parse(source, file, comments)
  } catch {
    return { tests: out, comments: [] }
  }
  const text = (node: Node): string => source.slice(node.start, node.end)
  const lineOf = (offset: number): number => source.slice(0, offset).split('\n').length
  // The local names of the imports from 'ubqtest'.
  const roles = new Map<string, string>()
  for (const node of children(tree))
    if (node.type === 'ImportDeclaration' && (node.source as Node & { value: string }).value === 'ubqtest')
      for (const spec of node.specifiers as (Node & { imported?: { name: string }; local: { name: string } })[])
        if (spec.imported) roles.set(spec.local.name, spec.imported.name)
  const role = (node: Node): string | undefined =>
    node.type === 'Identifier' ? roles.get(node.name as string) : undefined
  const nameOf = (node: Node | undefined): string | undefined => {
    if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
    const quasis = node?.quasis as (Node & { value: { cooked: string } })[] | undefined
    if (node?.type === 'TemplateLiteral' && quasis?.length === 1) return quasis[0]!.value.cooked
    return undefined
  }
  const skipOf = (options: Node | undefined): string | undefined => {
    if (options?.type !== 'ObjectExpression') return undefined
    for (const p of options.properties as (Node & { key: Node; value: Node })[]) {
      if (p.type !== 'Property' || (p.key.name ?? p.key.value) !== 'skip') continue
      if (p.value.type === 'Literal')
        return typeof p.value.value === 'string' && p.value.value ? p.value.value : undefined
      return `when ${oneLine(text(p.value))}`
    }
    return undefined
  }
  const assertsIn = (node: Node, found: string[]): string[] => {
    if (node.type === 'CallExpression') {
      const callee = node.callee as Node
      const target = callee.type === 'MemberExpression' ? (callee.object as Node) : callee
      if (role(target) === 'assert') found.push(oneLine(text(node)))
    }
    for (const child of children(node)) assertsIn(child, found)
    return found
  }
  const visit = (node: Node, prefix: string, skip: string | undefined): void => {
    if (node.type === 'CallExpression') {
      const kind = role(node.callee as Node)
      if (kind === 'test' || kind === 'describe') {
        const args = node.arguments as Node[]
        const name = nameOf(args[0])
        const fn = args.at(-1)
        if (name === undefined || !fn || args.length < 2) return
        const own = skipOf(args.length > 2 ? args[1] : undefined) ?? skip
        const id = `${prefix} > ${name}`
        if (kind === 'describe') return visit(fn, id, own)
        out.set(id, {
          line: lineOf(node.start),
          ...(own && { skip: own }),
          asserts: assertsIn(fn, []),
          body: oneLine(text(fn)),
        })
        return
      }
    }
    for (const child of children(node)) visit(child, prefix, skip)
  }
  visit(tree, file, undefined)
  return { tests: out, comments }
}

/** The items of `a` that `b` does not have, with each copy counted. */
const minus = (a: string[], b: string[]): string[] => {
  const left = [...b]
  return a.filter(item => {
    const at = left.indexOf(item)
    if (at < 0) return true
    left.splice(at, 1)
    return false
  })
}

/** The reasons of the `ubq: not measured:` comments (D56). */
const reasons = (comments: string[]): string[] =>
  comments.flatMap(c => {
    const m = /^\s*ubq: not measured:[ \t]*(.*)/.exec(c)
    return m ? [m[1]!.trim()] : []
  })

/** The kinds of items, in the order of the report. */
const KINDS = [
  'configuration',
  'removed',
  'skipped',
  'fewer assertions',
  'assertions changed',
  'snapshot removed',
  'snapshot changed',
  'not measured',
]

const lines = (sign: string, items: string[]): string[] =>
  items
    .slice(0, SHOWN)
    .map(item => `  ${sign} ${item}`)
    .concat(items.length > SHOWN ? [`  ${sign} and ${items.length - SHOWN} more`] : [])

export const reviewCommand = (args: string[], out: (line: string) => void): number => {
  const rest = [...args]
  const given = diffOption(rest)
  if (rest.length) throw new UsageError(`ubq review takes --diff=<commit>, not: ${rest.join(' ')}`)
  const ref = given ?? 'HEAD'
  // From the commit where the branch left `ref`: the newer commits of
  // `ref` are not changes of this branch.
  const fork = git('merge-base', ref, 'HEAD')
  if (!fork.ok) throw new UsageError(`ubq review needs a git commit. Not a commit here: ${ref}`)
  const base = fork.out.trim()
  const from = ref === 'HEAD' ? 'the last commit' : ref

  // Each changed file: its name at the base, and its name now.
  const pairs: [before: string | undefined, after: string | undefined][] = []
  const fields = git('diff', '--name-status', '-z', '-M', '--relative', base, '--', '.').out.split('\0')
  for (let i = 0; i + 1 < fields.length;) {
    const status = fields[i++]!
    if (status.startsWith('R')) pairs.push([fields[i++], fields[i++]])
    else if (status === 'D') pairs.push([fields[i++], undefined])
    else if (status === 'A') pairs.push([undefined, fields[i++]])
    else {
      const file = fields[i++]
      pairs.push([file, file])
    }
  }
  for (const file of git('ls-files', '-z', '--others', '--exclude-standard').out.split('\0'))
    if (file) pairs.push([undefined, file])

  const items: string[][] = []
  const notes: string[] = []

  // Changed code: the tests that ran its changed lines.
  const diff = changedLines(base)
  const store = existsSync(join(projectRoot(), '.ubq', 'runs.db')) ? openStore() : undefined
  /** For each test, the first changed line of code that it ran. */
  const ranChanged = new Map<string, string>()
  const old: string[] = []
  if (store) {
    // Test code is not the code that a test checks.
    const tests = new Set(testFiles(store.db))
    for (const [file, groups] of diff) {
      if (!CODE.test(file) || tests.has(file) || isHelper(file)) continue
      if (stale(store.db, file)) {
        old.push(file)
        continue
      }
      for (const [test, line] of testsOfLines(store.db, file, groups))
        if (!ranChanged.has(test)) ranChanged.set(test, `${file}:${line}`)
    }
    store.close()
  }

  for (const [before, after] of pairs) {
    const name = after ?? before!
    const textBefore = before === undefined ? undefined : atCommit(base, before)
    const textNow = after === undefined ? undefined : now(after)

    // A snapshot that changed, or that went away.
    const snap = SNAPSHOT.exec(name)
    if (snap) {
      const was = snapshotEntries(textBefore ?? '')
      const is = snapshotEntries(textNow ?? '')
      for (const [key, value] of was) {
        const id = `${snap[1]} > ${key}`
        if (!is.has(key)) items.push([`snapshot removed: ${id}`])
        else if (is.get(key) !== value)
          items.push([`snapshot changed: ${id}. To see it: git diff ${base.slice(0, 7)} -- ${name}`])
      }
      continue
    }

    // The configuration can leave tests out.
    if (name === 'package.json') {
      const key = (text: string | undefined): string => {
        try {
          return JSON.stringify(JSON.parse(text!).ubq) ?? '(none)'
        } catch {
          return '(not JSON)'
        }
      }
      if (key(textBefore) !== key(textNow))
        items.push([
          `configuration: the "ubq" key of package.json changed`,
          `  - ${key(textBefore)}`,
          `  + ${key(textNow)}`,
        ])
      continue
    }

    if (!CODE.test(name)) continue
    const then = before === undefined ? undefined : parsed(before, textBefore!)
    const is = after === undefined ? undefined : parsed(after, textNow!)
    // A comment that marks program code as not measured (D56). Not
    // in test code: no list of uncovered code has it.
    if (!then?.tests.size && !is?.tests.size && !isHelper(name) && !isBuild(name))
      for (const reason of minus(reasons(is?.comments ?? []), reasons(then?.comments ?? [])))
        items.push([`not measured: ${name}: ${reason || '(no reason)'}`])
    if (!then?.tests.size) continue
    // The IDs of the tests at the base, with the name of the file now.
    const was = new Map([...then.tests].map(([id, t]) => [after ? after + id.slice(before!.length) : id, t]))
    // A file that went away defines no tests.
    const tests = is?.tests ?? new Map<string, Defined>()
    const added = [...tests].filter(([id]) => !was.has(id))
    for (const [id, t] of was) {
      // A test with a new name has the same body, or each assertion of the old test.
      const match = tests.has(id)
        ? -1
        : added.findIndex(([, a]) => a.body === t.body || (t.asserts.length > 0 && !minus(t.asserts, a.asserts).length))
      const [newId, n] = match < 0 ? [id, tests.get(id)] : added.splice(match, 1)[0]!
      if (!n) {
        items.push([`removed: ${id} (${before}:${t.line} in ${base.slice(0, 7)})`])
        continue
      }
      const at = `${after}:${n.line}`
      const label = newId === id ? id : `${newId} (was ${id.slice(after!.length + 3)})`
      if (n.skip && !t.skip) items.push([`skipped: ${label} (${at}), skip: ${n.skip}`])
      const gone = minus(t.asserts, n.asserts)
      const fresh = minus(n.asserts, t.asserts)
      if (!gone.length) continue
      const code = ranChanged.get(newId)
      const why = code ? `. The test runs code that changed: ${code}` : ''
      const head =
        n.asserts.length < t.asserts.length
          ? `fewer assertions: ${label} (${at}), ${t.asserts.length} before, ${n.asserts.length} now${why}`
          : `assertions changed: ${label} (${at})${why}`
      items.push([head, ...lines('-', gone), ...lines('+', fresh)])
    }
  }

  if (old.length)
    notes.push(
      `note: code changed after the last run of its tests in ${old.join(', ')}, so review does not know which tests run the changed lines. Run: ubq --changed`,
    )
  else if (!store)
    notes.push('note: no run is stored, so review does not know which tests run the changed code. Run: ubq')
  // The kinds that can hide the most come first.
  const rank = (item: string[]): number => KINDS.indexOf(item[0]!.slice(0, item[0]!.indexOf(':')))
  for (const item of items.sort((a, b) => rank(a) - rank(b))) for (const line of item) out(line)
  for (const note of notes) out(note)
  out(
    items.length
      ? `review: ${items.length} changes to the tests for a person to look at, from ${from}`
      : `review: no test removed, skipped, or with changed assertions, from ${from}`,
  )
  return items.length ? 1 : 0
}
