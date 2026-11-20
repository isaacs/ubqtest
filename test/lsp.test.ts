// `ubq lsp`: the language server that shows coverage and failures
// in an editor.
import { spawn } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { cli, project, remove } from './setup.ts'

interface Message {
  id?: number
  method?: string
  params?: any
  result?: any
  error?: { code: number; message: string }
}

/** A client of the language server, over stdio. */
const client = (cwd: string) => {
  const server = spawn(process.execPath, [cli, 'lsp'], { cwd, stdio: ['pipe', 'pipe', 'inherit'] })
  const got: Message[] = []
  const waiting: (() => void)[] = []
  let buffer = Buffer.alloc(0)
  server.stdout.on('data', (data: Buffer) => {
    buffer = Buffer.concat([buffer, data])
    for (;;) {
      const end = buffer.indexOf('\r\n\r\n')
      if (end < 0) return
      const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())?.[1])
      if (buffer.length < end + 4 + length) return
      got.push(JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString()) as Message)
      buffer = buffer.subarray(end + 4 + length)
      for (const wake of waiting.splice(0)) wake()
    }
  })
  let id = 0
  const send = (message: Message): void => {
    const text = JSON.stringify({ jsonrpc: '2.0', ...message })
    server.stdin.write(`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`)
  }
  /**
   * The first message from now on that `match` accepts. The wait
   * ends when the message comes. The limit is only for a server
   * that sends no such message, and a slow machine must not reach it.
   */
  const next = async (match: (m: Message) => boolean, from = got.length): Promise<Message> => {
    const limit = Date.now() + 60_000
    for (;;) {
      const found = got.slice(from).find(match)
      if (found) return found
      if (Date.now() > limit) throw new Error(`no such message. Got: ${JSON.stringify(got.slice(from))}`)
      await new Promise<void>(resolve => {
        waiting.push(resolve)
        setTimeout(resolve, 200)
      })
    }
  }
  const request = async (method: string, params: unknown): Promise<Message> => {
    const from = got.length
    send({ id: ++id, method, params })
    const mine = id
    return next(m => m.id === mine, from)
  }
  return { server, send, next, request, count: () => got.length, since: (from: number) => got.slice(from) }
}

const SIGN = 'export const sign = (n: number) => {\n  if (n < 0) return -1\n  return 1\n}\n'

test('the language server shows code that no test ran, failures, and the tests of a line', async () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  writeFileSync(join(p.dir, 'src/sign.ts'), SIGN)
  const A = `import { assert, test } from 'ubqtest'
import { sign } from './src/sign.ts'
test('positive', () => assert.equal(sign(2), 1))
test('wrong', () => assert.equal(sign(3), 2))
`
  writeFileSync(join(p.dir, 'a.test.ts'), A)
  assert.equal(p.ubq('a.test.ts').code, 1)

  const c = client(p.dir)
  cleanup(() => void c.server.kill())
  const uri = (file: string) => pathToFileURL(join(p.dir, file)).href
  const init = await c.request('initialize', { processId: process.pid, rootUri: pathToFileURL(p.dir).href })
  assert.equal(init.result.capabilities.hoverProvider, true)
  c.send({ method: 'initialized', params: {} })
  const diagnostics = (file: string, from?: number) =>
    c.next(m => m.method === 'textDocument/publishDiagnostics' && m.params.uri === uri(file), from)

  // Code that no test ran, from the store.
  let from = c.count()
  c.send({
    method: 'textDocument/didOpen',
    params: { textDocument: { uri: uri('src/sign.ts'), languageId: 'typescript', version: 1, text: SIGN } },
  })
  const sign = (await diagnostics('src/sign.ts', from)).params.diagnostics
  assert.equal(sign.length, 1)
  assert.match(sign[0], {
    range: { start: { line: 1, character: 13 }, end: { line: 1, character: 22 } },
    source: 'ubq',
    message: 'no test ran this code',
  })

  // The failure of a test, at its assertion.
  from = c.count()
  c.send({
    method: 'textDocument/didOpen',
    params: { textDocument: { uri: uri('a.test.ts'), languageId: 'typescript', version: 1, text: A } },
  })
  const failures = (await diagnostics('a.test.ts', from)).params.diagnostics
  assert.equal(failures.length, 1)
  assert.match(failures[0], { range: { start: { line: 3 } }, severity: 1, source: 'ubq' })
  assert.match(failures[0].message, /^a\.test\.ts > wrong: expected values to be equal\nactual: {3}1\nexpected: 2/)

  // The tests that ran a line.
  const hover = await c.request('textDocument/hover', {
    textDocument: { uri: uri('src/sign.ts') },
    position: { line: 2, character: 3 },
  })
  assert.match(hover.result.contents.value, /2 tests ran this code:\n- a\.test\.ts > positive\n- a\.test\.ts > wrong/)
  const hoverAt = async (file: string, line: number, character: number) =>
    (await c.request('textDocument/hover', { textDocument: { uri: uri(file) }, position: { line, character } })).result
  // Code that runs while the test file loads.
  assert.match((await hoverAt('src/sign.ts', 0, 0)).contents.value, /\n- a\.test\.ts \(while it loads\)$/)
  // Code that no test ran, and a file that is not open.
  assert.equal(await hoverAt('src/sign.ts', 1, 16), null)
  assert.equal(await hoverAt('src/shape.ts', 0, 0), null)

  // The places of the tests that ran the code at a place, for a jump
  // to them. Code that runs while a test file loads gives the test
  // file.
  const testsAt = async (file: string, line: number, character: number) =>
    (await c.request('ubq/tests', { textDocument: { uri: uri(file) }, position: { line, character } })).result
  const place = (file: string, line: number) => ({
    uri: uri(file),
    range: { start: { line, character: 0 }, end: { line, character: 0 } },
  })
  assert.deepEqual(await testsAt('src/sign.ts', 2, 3), [place('a.test.ts', 2), place('a.test.ts', 3)])
  assert.deepEqual(await testsAt('src/sign.ts', 0, 0), [place('a.test.ts', 0)])
  assert.deepEqual(await testsAt('src/sign.ts', 1, 16), [])
  assert.deepEqual(await testsAt('src/shape.ts', 0, 0), [])

  // An action runs the tests that ran the line of the cursor. Code
  // that runs while a test file loads gives the test file.
  const actions = async (line: number) =>
    (
      await c.request('textDocument/codeAction', {
        textDocument: { uri: uri('src/sign.ts') },
        range: { start: { line, character: 0 }, end: { line, character: 0 } },
        context: { diagnostics: [] },
      })
    ).result
  const action = (...args: string[]) => ({
    title: 'Run the tests that ran this line (ubq)',
    command: { title: 'Run the tests that ran this line (ubq)', command: 'ubq.run', arguments: args },
  })
  assert.deepEqual(await actions(2), [action('a.test.ts > positive', 'a.test.ts > wrong')])
  assert.deepEqual(await actions(0), [action('a.test.ts > positive', 'a.test.ts > wrong', 'a.test.ts')])
  // A line with no code, and code that no test ran.
  assert.deepEqual(await actions(4), [])
  from = c.count()
  const ran = await c.request('workspace/executeCommand', {
    command: 'ubq.run',
    arguments: ['a.test.ts > positive', 'a.test.ts > wrong'],
  })
  // The server answers when the run ends, with a message at the
  // start and at the end. Type 3 is Info, type 1 is Error.
  assert.equal(ran.result, null)
  assert.deepEqual(
    c
      .since(from)
      .filter(m => m.method === 'window/showMessage')
      .map(m => [m.params.type, m.params.message]),
    [
      [3, 'ubq run a.test.ts > positive, a.test.ts > wrong'],
      [1, 'fail: 1 failed, 1 passed (run 2: ubq failures 2)'],
    ],
  )
  from = c.count()
  await c.request('workspace/executeCommand', { command: 'ubq.run', arguments: ['a.test.ts > positive'] })
  assert.deepEqual(
    c
      .since(from)
      .filter(m => m.method === 'window/showMessage')
      .map(m => m.params.type),
    [3, 3],
  )
  // An error of the command is the message.
  from = c.count()
  await c.request('workspace/executeCommand', { command: 'ubq.run', arguments: ['gone.test.ts'] })
  assert.deepEqual(
    c
      .since(from)
      .filter(m => m.method === 'window/showMessage')
      .at(-1)?.params,
    {
      type: 1,
      message: 'ubq: no such file: gone.test.ts',
    },
  )

  // A change in the editor: the stored places are not the places of
  // the text, so the server shows only that.
  from = c.count()
  c.send({
    method: 'textDocument/didChange',
    params: {
      textDocument: { uri: uri('src/sign.ts'), version: 2 },
      contentChanges: [{ text: `// a change\n${SIGN}` }],
    },
  })
  // The runs above changed the store, and the server sends the
  // diagnostics of each open file again a short time after such a
  // change. That message can come after the change in the editor,
  // with the same content. The test waits for the content.
  const changed = await c.next(
    m =>
      m.method === 'textDocument/publishDiagnostics' &&
      m.params.uri === uri('src/sign.ts') &&
      m.params.diagnostics[0]?.message.startsWith('this file changed') === true,
    from,
  )
  assert.deepEqual(
    changed.params.diagnostics.map((d: { message: string; severity: number }) => [d.message, d.severity]),
    [['this file changed after the last run of its tests. Run them again: ubq --changed', 3]],
  )
  const none = await c.request('textDocument/hover', {
    textDocument: { uri: uri('src/sign.ts') },
    position: { line: 3, character: 3 },
  })
  assert.equal(none.result, null)
  const stale = await c.request('textDocument/codeAction', {
    textDocument: { uri: uri('src/sign.ts') },
    range: { start: { line: 3, character: 0 }, end: { line: 3, character: 0 } },
  })
  assert.deepEqual(stale.result, [])
  assert.deepEqual(await testsAt('src/sign.ts', 3, 3), [])

  // A new run updates the open files, with no request.
  c.send({
    method: 'textDocument/didChange',
    params: { textDocument: { uri: uri('src/sign.ts'), version: 3 }, contentChanges: [{ text: SIGN }] },
  })
  writeFileSync(join(p.dir, 'a.test.ts'), A.replace('sign(3), 2', 'sign(-3), -1'))
  from = c.count()
  assert.equal(p.ubq('a.test.ts').code, 0)
  await c.next(
    m =>
      m.method === 'textDocument/publishDiagnostics' &&
      m.params.uri === uri('src/sign.ts') &&
      m.params.diagnostics.length === 0,
    from,
  )

  // A closed file has no diagnostics.
  from = c.count()
  c.send({ method: 'textDocument/didClose', params: { textDocument: { uri: uri('a.test.ts') } } })
  await c.next(
    m =>
      m.method === 'textDocument/publishDiagnostics' &&
      m.params.uri === uri('a.test.ts') &&
      !m.params.diagnostics.length,
    from,
  )

  // Close, shutdown, and exit.
  assert.deepEqual((await c.request('shutdown', null)).result, null)
  const exit = new Promise(resolve => c.server.on('exit', resolve))
  c.send({ method: 'exit' })
  assert.equal(await exit, 0)
  assert(readFileSync(join(p.dir, 'src/sign.ts'), 'utf8') === SIGN)
})

test('the language server: no store, a store that comes later, other files, and an end with no exit', async () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  const c = client(p.dir)
  cleanup(() => void c.server.kill())
  await c.request('initialize', { processId: null, rootUri: pathToFileURL(p.dir).href })
  const unknown = await c.request('textDocument/rename', {})
  assert.equal(unknown.error?.code, -32601)
  const command = await c.request('workspace/executeCommand', { command: 'nope', arguments: [] })
  assert.equal(command.error?.code, -32601)
  const action = await c.request('textDocument/codeAction', {
    textDocument: { uri: 'untitled:Untitled-1' },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  })
  assert.deepEqual(action.result, [])
  const publish = async (uri: string, text = '') => {
    const from = c.count()
    c.send({ method: 'textDocument/didOpen', params: { textDocument: { uri, version: 1, text } } })
    return (await c.next(m => m.method === 'textDocument/publishDiagnostics' && m.params.uri === uri, from)).params
      .diagnostics
  }
  // No store, a URI that is not a file, and a file of a different project.
  const pass = pathToFileURL(join(p.dir, 'pass.ts')).href
  const text = readFileSync(join(p.dir, 'pass.ts'), 'utf8')
  assert.deepEqual(await publish(pass, text), [])
  const noStore = await c.request('textDocument/codeAction', {
    textDocument: { uri: pass },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  })
  assert.deepEqual(noStore.result, [])
  const noTests = await c.request('ubq/tests', { textDocument: { uri: pass }, position: { line: 0, character: 0 } })
  assert.deepEqual(noTests.result, [])
  assert.deepEqual(await publish('untitled:Untitled-1'), [])
  assert.deepEqual(await publish(pathToFileURL(join(p.dir, '..', 'other.ts')).href), [])

  // The first run makes the store. The open files get new diagnostics.
  // A change of a different file does not.
  writeFileSync(join(p.dir, 'notes.txt'), 'x')
  await new Promise(resolve => setTimeout(resolve, 100))
  const from = c.count()
  p.ubq('pass.ts')
  await c.next(m => m.method === 'textDocument/publishDiagnostics' && m.params.uri === pass, from)

  // A message in three parts.
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 99,
    method: 'textDocument/hover',
    params: { textDocument: { uri: 'untitled:Untitled-1' }, position: { line: 0, character: 0 } },
  })
  const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
  const at = c.count()
  c.server.stdin.write(message.slice(0, 10))
  await new Promise(resolve => setTimeout(resolve, 50))
  c.server.stdin.write(message.slice(10, -5))
  await new Promise(resolve => setTimeout(resolve, 50))
  c.server.stdin.write(message.slice(-5))
  assert.equal((await c.next(m => m.id === 99, at)).result, null)

  // A store that cannot be read is no store.
  writeFileSync(join(p.dir, '.ubq/runs.db'), 'not a database')
  assert.deepEqual(await publish(pathToFileURL(join(p.dir, 'fail.ts')).href), [])

  // The end of stdin with no exit: the exit code is 1.
  const exit = new Promise(resolve => c.server.on('exit', resolve))
  c.server.stdin.end()
  assert.equal(await exit, 1)
})

test('the language server: a file error, a file with no run, and a line that many tests ran', async () => {
  const p = project()
  // On Windows, the server keeps its folder for a short time after
  // the kill.
  cleanup(() => remove(p.dir))
  writeFileSync(join(p.dir, 'src/sign.ts'), SIGN)
  const many = Array.from({ length: 21 }, (_, i) => `test('t${i}', () => assert.equal(sign(${i + 1}), 1))`)
  writeFileSync(
    join(p.dir, 'm.test.ts'),
    `import { assert, test } from 'ubqtest'\nimport { sign } from './src/sign.ts'\n${many.join('\n')}\ntest('minus', () => assert.equal(sign(-1), -1))\n`,
  )
  writeFileSync(join(p.dir, 'src/f.ts'), 'export const f = (n: number) => {\n  if (n) return 1\n  return 2\n}\n')
  writeFileSync(
    join(p.dir, 'f.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { f } from './src/f.ts'\ntest('f', () => assert.equal(f(1), 1))\n",
  )
  const E = "import { test } from 'ubqtest'\nthrow new Error('boom')\n"
  writeFileSync(join(p.dir, 'e.test.ts'), E)
  p.ubq('m.test.ts', 'e.test.ts', 'f.test.ts')
  const c = client(p.dir)
  cleanup(() => void c.server.kill())
  await c.request('initialize', { processId: null, rootUri: pathToFileURL(p.dir).href })
  const uri = (file: string) => pathToFileURL(join(p.dir, file)).href
  const open = async (file: string) => {
    const from = c.count()
    const text = readFileSync(join(p.dir, file), 'utf8')
    c.send({ method: 'textDocument/didOpen', params: { textDocument: { uri: uri(file), version: 1, text } } })
    return (await c.next(m => m.method === 'textDocument/publishDiagnostics' && m.params.uri === uri(file), from))
      .params.diagnostics
  }
  const error = await open('e.test.ts')
  assert.equal(error.length, 1)
  assert.match(error[0], { range: { start: { line: 1 } }, severity: 1 })
  assert.match(error[0].message, /^e\.test\.ts: .*boom/)
  // No test ran this file.
  assert.deepEqual(await open('src/shape.ts'), [])
  // 22 tests ran the start of the function, and 1 test ran `return -1`.
  await open('src/sign.ts')
  const hover = async (line: number, character: number) =>
    (
      await c.request('textDocument/hover', {
        textDocument: { uri: uri('src/sign.ts') },
        position: { line, character },
      })
    ).result.contents.value
  assert.match(
    await hover(1, 4),
    /^22 tests ran this code:\n(- m\.test\.ts > \w+\n){20}- and 2 more: ubq covers src\/sign\.ts:2$/,
  )
  assert.equal(await hover(1, 16), '1 test ran this code:\n- m.test.ts > minus')
  const tests = async (file: string, line: number, character: number) =>
    (await c.request('ubq/tests', { textDocument: { uri: uri(file) }, position: { line, character } })).result
  const place = (line: number) => ({
    uri: uri('m.test.ts'),
    range: { start: { line, character: 0 }, end: { line, character: 0 } },
  })
  // All 22, in the order of their names: `minus` is on line 24.
  const all = await tests('src/sign.ts', 1, 4)
  assert.deepEqual([all.length, all[0], all[1]], [22, place(23), place(2)])
  // A file that no test ran.
  assert.deepEqual(await tests('src/shape.ts', 0, 0), [])
  // No action for a line that no test ran.
  await open('src/f.ts')
  const none = await c.request('textDocument/codeAction', {
    textDocument: { uri: uri('src/f.ts') },
    range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
  })
  assert.deepEqual(none.result, [])
})
