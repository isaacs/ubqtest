// The restore form of a test helper, in the files of one run of
// `ubq convert`. A helper gives a function that puts its spies back,
// and a test file calls that function in a hook:
//
//   // helper.ts
//   export const mockFetch = () => {
//     const spy = vi.spyOn(globalThis, 'fetch')
//     return { calls, restore: () => spy.mockRestore() }
//   }
//   // a.test.ts
//   let restore = () => {}
//   afterEach(() => restore())
//   const m = mockFetch()
//   restore = m.restore
//
// ubq puts each spy back when its test ends. So the declaration, the
// hook, and each assignment can go. The property of the helper can
// go when no other code of the run reads it.
import { dirname, resolve } from 'node:path'
import type { Node } from './instrument.ts'

type Parse = (source: string, file: string) => Node
type Children = (node: Node) => Node[]

const FUNCTION = new Set(['ArrowFunctionExpression', 'FunctionExpression'])
const HOOK = /^(before|after)(Each|All)?$/

const nameOf = (node: Node | undefined | null): string | undefined =>
  node?.type === 'Identifier' ? (node as unknown as { name: string }).name : undefined

/** The single expression of a function body: `() => x` or `() => { x }`. */
const only = (fn: Node): Node | undefined => {
  const body = fn.body as Node
  if (body.type !== 'BlockStatement') return body
  const statements = body.body as unknown as Node[]
  return statements.length === 1 && statements[0]!.type === 'ExpressionStatement'
    ? (statements[0]!.expression as Node)
    : undefined
}

/** `() => spy.mockRestore()`. */
const restoresSpy = (fn: Node): boolean => {
  if (!FUNCTION.has(fn.type) || (fn.params as Node[]).length) return false
  const call = only(fn)
  const callee = call?.type === 'CallExpression' ? (call.callee as Node) : undefined
  return (
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    nameOf(callee.property as Node) === 'mockRestore' &&
    !(call!.arguments as Node[]).length
  )
}

/** A key that is a name: `restore: ...`. */
const keyOf = (property: Node): string | undefined =>
  property.type === 'Property' && !property.computed && !property.shorthand && property.kind === 'init'
    ? nameOf(property.key as Node)
    : undefined

/** The path of a relative import, if it is a file of the run. */
const resolveImport = (from: string, specifier: unknown, files: Map<string, unknown>): string | undefined => {
  if (typeof specifier !== 'string' || !specifier.startsWith('.')) return undefined
  const base = resolve(dirname(from), specifier)
  return [base, base.replace(/\.js$/, '.ts'), base.replace(/\.mjs$/, '.mts'), `${base}.ts`, `${base}.js`].find(path =>
    files.has(path),
  )
}

/**
 * For each file of the run: the start of each statement and each
 * property that the conversion removes.
 */
export const restorePlan = (
  sources: Map<string, string>,
  parse: Parse,
  children: Children,
): Map<string, Set<number>> => {
  const programs = new Map<string, Node>()
  for (const [file, source] of sources)
    try {
      programs.set(file, parse(source, file))
    } catch {
      // The conversion of the file reports the error.
    }

  /** Each node of a program, with its parent. */
  const parents = new Map<Node, Node | undefined>()
  const all = new Map<string, Node[]>()
  for (const [file, program] of programs) {
    const nodes: Node[] = []
    const walk = (node: Node, parent: Node | undefined): void => {
      parents.set(node, parent)
      nodes.push(node)
      for (const child of children(node)) walk(child, node)
    }
    walk(program, undefined)
    all.set(file, nodes)
  }

  // The functions of helpers that give restore functions:
  // `${file}#${name}` to each key and the properties of that key.
  const helpers = new Map<string, Map<string, Node[]>>()
  for (const [file, program] of programs)
    for (const statement of program.body as unknown as Node[]) {
      if (statement.type !== 'ExportNamedDeclaration' || !statement.declaration) continue
      const declaration = statement.declaration as Node
      const found: [string, Node][] =
        declaration.type === 'FunctionDeclaration'
          ? [[nameOf(declaration.id as Node)!, declaration]]
          : declaration.type === 'VariableDeclaration'
            ? (declaration.declarations as unknown as Node[]).flatMap(d =>
                d.init && FUNCTION.has((d.init as Node).type) && nameOf(d.id as Node)
                  ? [[nameOf(d.id as Node)!, d.init as Node] as [string, Node]]
                  : [],
              )
            : []
      for (const [name, fn] of found) {
        // The objects that the function gives: each must be an object
        // literal.
        const objects: Node[] = []
        if ((fn.body as Node).type !== 'BlockStatement') objects.push(fn.body as Node)
        else {
          const walk = (node: Node): void => {
            if (node !== fn && (FUNCTION.has(node.type) || node.type === 'FunctionDeclaration')) return
            if (node.type === 'ReturnStatement') objects.push(node.argument as Node)
            for (const child of children(node)) walk(child)
          }
          walk(fn)
        }
        if (!objects.length || objects.some(o => o?.type !== 'ObjectExpression')) continue
        const keys = new Map<string, Node[]>()
        const first = objects[0]!.properties as unknown as Node[]
        for (const property of first) {
          const key = keyOf(property)
          if (!key || !restoresSpy(property.value as Node)) continue
          const each = objects.map(o =>
            (o.properties as unknown as Node[]).find(p => keyOf(p) === key && restoresSpy(p.value as Node)),
          )
          if (each.every(Boolean)) keys.set(key, each as Node[])
        }
        if (keys.size) helpers.set(`${file}#${name}`, keys)
      }
    }

  const drop = new Map<string, Set<number>>()
  const add = (file: string, at: number): void => void (drop.get(file) ?? drop.set(file, new Set()).get(file)!).add(at)
  /** `${helper}.${key}`: the count of places that read the key, and those that the conversion removes. */
  const reads = new Map<string, { all: number; removed: number }>()
  const read = (helper: string, key: string, removed: boolean): void => {
    const r = reads.get(`${helper}.${key}`) ?? { all: 0, removed: 0 }
    r.all++
    if (removed) r.removed++
    reads.set(`${helper}.${key}`, r)
  }
  /** Helpers that a file of the run exports again: code that the run does not see can read them. */
  const again = new Set<string>()

  for (const [file, program] of programs) {
    const nodes = all.get(file)!
    /** The local name of each imported helper function. */
    const imported = new Map<string, string>()
    for (const statement of program.body as unknown as Node[]) {
      const from = (statement.source as { value?: unknown } | undefined)?.value
      const target = resolveImport(file, from, programs)
      if (!target) continue
      if (statement.type !== 'ImportDeclaration') {
        for (const helper of helpers.keys()) if (helper.startsWith(`${target}#`)) again.add(helper)
        continue
      }
      for (const s of statement.specifiers as unknown as Node[]) {
        const helper = `${target}#${nameOf(s.imported as Node)}`
        if (s.type === 'ImportSpecifier' && helpers.has(helper)) imported.set(nameOf(s.local as Node)!, helper)
      }
    }
    // A helper of this file that this file also calls.
    for (const helper of helpers.keys())
      if (helper.startsWith(`${file}#`)) imported.set(helper.slice(file.length + 1), helper)

    const references = (name: string): Node[] =>
      nodes.filter(n => {
        if (nameOf(n) !== name) return false
        const parent = parents.get(n)!
        // `a.name` is not a reference.
        if (parent.type === 'MemberExpression' && parent.property === n && !parent.computed) return false
        return parent.type !== 'ImportSpecifier' && parent.type !== 'ExportSpecifier'
      })

    // The values that a helper call gives: `const m = mockFetch()`.
    const values = new Map<string, string>()
    /** The declarations of those values. */
    const declared = new Set<Node>()
    for (const [local, helper] of imported)
      for (const ref of references(local)) {
        const parent = parents.get(ref)!
        // The declaration of the helper, in its own file.
        if ((parent.type === 'VariableDeclarator' || parent.type === 'FunctionDeclaration') && parent.id === ref)
          continue
        const call = parent.type === 'CallExpression' && parent.callee === ref ? parent : undefined
        const outer = call && parents.get(call)
        const init = outer?.type === 'AwaitExpression' ? outer : call
        const declarator = init && parents.get(init)
        const name =
          declarator?.type === 'VariableDeclarator' && declarator.init === init
            ? nameOf(declarator.id as Node)
            : undefined
        if (name) {
          values.set(name, helper)
          declared.add(declarator!)
        } else
          // Any other use: the run cannot know which keys are read.
          for (const key of helpers.get(helper)!.keys()) read(helper, key, false)
      }
    // A name that the file also declares for an other value.
    for (const [name, helper] of values)
      if (
        references(name).some(ref => {
          const parent = parents.get(ref)!
          return (
            (parent.type === 'VariableDeclarator' && parent.id === ref && !declared.has(parent)) ||
            FUNCTION.has(parent.type)
          )
        })
      ) {
        values.delete(name)
        for (const key of helpers.get(helper)!.keys()) read(helper, key, false)
      }

    // The restore variables: `let restore` and a hook that calls it.
    const hooks = nodes.filter(
      n =>
        n.type === 'ExpressionStatement' &&
        (n.expression as Node).type === 'CallExpression' &&
        HOOK.test(nameOf((n.expression as Node).callee as Node) ?? '') &&
        ((n.expression as Node).arguments as Node[]).length === 1,
    )
    /** The assignments that the conversion removes, for each restore variable. */
    const removed = new Set<Node>()
    for (const hook of hooks) {
      const fn = ((hook.expression as Node).arguments as Node[])[0]!
      let call = FUNCTION.has(fn.type) && !(fn.params as Node[]).length ? only(fn) : undefined
      // `() => restore?.()`
      if (call?.type === 'ChainExpression') call = call.expression as Node
      const name =
        call?.type === 'CallExpression' && !(call.arguments as Node[]).length ? nameOf(call.callee as Node) : undefined
      if (!name) continue
      const refs = references(name)
      const declarations = refs.filter(r => parents.get(r)!.type === 'VariableDeclarator')
      const declarator = declarations.length === 1 ? parents.get(declarations[0]!)! : undefined
      const statement = declarator && parents.get(declarator)!
      const init = declarator?.init as Node | null | undefined
      if (
        !statement ||
        statement.kind !== 'let' ||
        (statement.declarations as unknown as Node[]).length !== 1 ||
        (init &&
          nameOf(init) !== 'undefined' &&
          !(
            FUNCTION.has(init.type) &&
            (init.body as Node).type === 'BlockStatement' &&
            !((init.body as Node).body as unknown as Node[]).length
          ))
      )
        continue
      // Each other reference: the call in this hook, or `name = m.key`.
      const assignments: [Node, string, string][] = []
      let ok = true
      for (const ref of refs) {
        if (ref === declarations[0] || ref === call!.callee) continue
        const assign = parents.get(ref)!
        const right = assign.right as Node | undefined
        const helper = right?.type === 'MemberExpression' ? values.get(nameOf(right.object as Node) ?? '') : undefined
        const key = helper && !right!.computed ? nameOf(right!.property as Node) : undefined
        if (
          assign.type === 'AssignmentExpression' &&
          assign.left === ref &&
          assign.operator === '=' &&
          parents.get(assign)!.type === 'ExpressionStatement' &&
          key &&
          helpers.get(helper!)!.has(key)
        )
          assignments.push([parents.get(assign)!, helper!, key])
        else ok = false
      }
      if (!ok) continue
      add(file, statement.start)
      add(file, hook.start)
      for (const [assignment, helper, key] of assignments) {
        add(file, assignment.start)
        removed.add((assignment.expression as Node).right as Node)
        read(helper, key, true)
      }
    }

    // Each other read of a value of a helper call.
    for (const [name, helper] of values)
      for (const ref of references(name)) {
        const parent = parents.get(ref)!
        if (parent.type === 'VariableDeclarator' && parent.id === ref) continue
        if (parent.type === 'MemberExpression' && parent.object === ref && !parent.computed) {
          const key = nameOf(parent.property as Node)!
          if (helpers.get(helper)!.has(key) && !removed.has(parent)) read(helper, key, false)
        } else for (const key of helpers.get(helper)!.keys()) read(helper, key, false)
      }
  }

  // A key that only the removed assignments read.
  for (const [helper, keys] of helpers) {
    if (again.has(helper)) continue
    const file = helper.slice(0, helper.lastIndexOf('#'))
    for (const [key, properties] of keys) {
      const r = reads.get(`${helper}.${key}`)
      if (r && r.all === r.removed) for (const property of properties) add(file, property.start)
    }
  }
  return drop
}
