// `ubq lsp`: a language server over stdio (D63). It reads the store
// and shows, for each open file, the code that no test ran and the
// failures of the last run of each test. A hover names the tests
// that ran the code there. A new run updates the open files.
import { spawn } from 'node:child_process'
import { hash } from 'node:crypto'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Failure } from './events.ts'
import { projectRoot } from './project.ts'
import { covers, coversAt, stale, uncovered } from './query.ts'
import { DatabaseSync } from './sqlite.ts'
import { fileHash } from './store.ts'

interface Message {
  id?: number | string
  method?: string
  params?: any
}

interface Position {
  line: number
  character: number
}

interface Diagnostic {
  range: { start: Position; end: Position }
  severity: 1 | 2 | 3 | 4
  source: 'ubq'
  message: string
}

const ERROR = 1
const INFORMATION = 3
const CHANGED = 'this file changed after the last run of its tests. Run them again: ubq --changed'
/** The most tests that a hover names. */
const HOVER_TESTS = 20

const write = (message: object): void => {
  const text = JSON.stringify({ jsonrpc: '2.0', ...message })
  process.stdout.write(`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`)
}

/** The path of a `file:` URI from the project root, if it is in the project. */
const fileOf = (uri: string): string | undefined => {
  if (!uri.startsWith('file:')) return undefined
  const path = relative(projectRoot(), fileURLToPath(uri))
  if (!path || path.startsWith('..') || path.startsWith(sep) || /^[a-z]:/i.test(path)) return undefined
  return path.split(sep).join('/')
}

/**
 * Runs `use` on the store, if there is one. A store that cannot be
 * read is no store. The connection is not read-only: Bun on macOS
 * cannot open a WAL database read-only if it has no `-shm` file.
 */
const withStore = <T>(use: (db: DatabaseSync) => T): T | undefined => {
  const path = join(projectRoot(), '.ubq', 'runs.db')
  if (!existsSync(path)) return undefined
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(path, { timeout: 1000 })
    return use(db)
  } catch {
    return undefined
  } finally {
    db?.close()
  }
}

/** True if the store has a run of the code of `file`. */
const known = (db: DatabaseSync, file: string): boolean =>
  !!db.prepare('select 1 from coverage where file = ?1 union all select 1 from test_file where tfile = ?1').get(file)

/**
 * True if the stored places are not the places of `text`: the text
 * differs from the file, or the file changed after its last run.
 */
const changed = (db: DatabaseSync, file: string, text: string): boolean =>
  hash('sha1', text) !== fileHash(file) || stale(db, file)

/** The failures of the last run of each test, and the file errors of the last run of each test file. */
const failures = (db: DatabaseSync): { title: string; failure: Failure }[] => [
  ...(
    db
      .prepare(
        `select id, failure from test t where status = 'fail' and failure is not null
         and run = (select max(run) from test where id = t.id)`,
      )
      .all() as { id: string; failure: string }[]
  ).map(r => ({ title: r.id, failure: JSON.parse(r.failure) as Failure })),
  ...(
    db
      .prepare('select e.file, e.failure from file_error e join test_file f on f.tfile = e.file and f.run = e.run')
      .all() as { file: string; failure: string }[]
  ).map(r => ({ title: r.file, failure: JSON.parse(r.failure) as Failure })),
]

const diagnosticsOf = (file: string, text: string): Diagnostic[] =>
  withStore(db => {
    if (!known(db, file)) return []
    if (changed(db, file, text))
      return [{ range: { start: at(0, 0), end: at(0, 0) }, severity: INFORMATION, source: 'ubq', message: CHANGED }]
    const out: Diagnostic[] = uncovered(db, file)
      .filter(u => !u.notMeasured)
      .map(u => ({
        range: { start: at(u.line - 1, u.column - 1), end: at(u.end.line - 1, u.end.column - 1) },
        severity: INFORMATION,
        source: 'ubq',
        message: 'no test ran this code',
      }))
    for (const { title, failure } of failures(db)) {
      if (failure.at?.file !== file) continue
      const line = failure.at.line - 1
      const message = [`${title}: ${failure.message}`]
      if (failure.actual !== undefined) message.push(`actual:   ${failure.actual}`)
      if (failure.expected !== undefined) message.push(`expected: ${failure.expected}`)
      out.push({
        // To the end of the line: the start of the next line.
        range: { start: at(line, failure.at.column - 1), end: at(line + 1, 0) },
        severity: ERROR,
        source: 'ubq',
        message: message.join('\n'),
      })
    }
    return out
  }) ?? []

const at = (line: number, character: number): Position => ({ line, character })

/** The offset of a position in `text`. */
const offsetOf = (text: string, { line, character }: Position): number => {
  let offset = 0
  for (let n = 0; n < line; n++) offset = text.indexOf('\n', offset) + 1
  return offset + character
}

const hoverOf = (file: string, text: string, position: Position): object | null =>
  withStore(db => {
    if (!known(db, file) || changed(db, file, text)) return null
    const { tests, loads } = coversAt(db, file, offsetOf(text, position))
    const all = [...tests.sort(), ...loads.sort().map(f => `${f} (while it loads)`)]
    if (!all.length) return null
    const shown = all.slice(0, HOVER_TESTS).map(t => `- ${t}`)
    if (all.length > HOVER_TESTS)
      shown.push(`- and ${all.length - HOVER_TESTS} more: ubq covers ${file}:${position.line + 1}`)
    const count = all.length === 1 ? '1 test ran' : `${all.length} tests ran`
    return { contents: { kind: 'markdown', value: `${count} this code:\n${shown.join('\n')}` } }
  }) ?? null

const RUN = 'Run the tests that ran this line (ubq)'

/** The action that runs the tests that ran a line, if there are some. */
const actionsOf = (file: string, text: string, line: number): object[] =>
  withStore(db => {
    if (!known(db, file) || changed(db, file, text)) return []
    let found
    try {
      found = covers(db, file, line + 1)
    } catch {
      // A line with no code.
      return []
    }
    // A test file runs in full for code that runs while it loads.
    const args = [...found.tests.sort(), ...found.loads.sort()]
    return args.length ? [{ title: RUN, command: { title: RUN, command: 'ubq.run', arguments: args } }] : []
  }) ?? []

export const lsp = (): Promise<number> =>
  new Promise(done => {
    /** The text of each open file, by URI. */
    const open = new Map<string, string>()
    let ended = false

    const publish = (uri: string): void => {
      const file = fileOf(uri)
      const text = open.get(uri)
      const diagnostics = file === undefined || text === undefined ? [] : diagnosticsOf(file, text)
      write({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } })
    }

    // A run writes the store: each open file gets new diagnostics.
    // The folder of the store can come later than the server.
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        for (const uri of open.keys()) publish(uri)
      }, 200)
    }
    const watchers: FSWatcher[] = []
    const watchStore = (): void => {
      const dir = join(projectRoot(), '.ubq')
      if (existsSync(dir)) watchers.push(watch(dir, refresh))
      else {
        const root = watch(projectRoot(), (_, name) => {
          if (name !== '.ubq' || !existsSync(dir)) return
          root.close()
          watchers.push(watch(dir, refresh))
          refresh()
        })
        watchers.push(root)
      }
    }

    const handle = (message: Message): void => {
      const { id, method, params } = message
      switch (method) {
        case 'initialize': {
          // With no root folder, the project is that of the working
          // directory.
          const root = params?.rootUri
          if (typeof root === 'string' && root.startsWith('file:')) process.chdir(fileURLToPath(root))
          watchStore()
          write({
            id,
            result: {
              capabilities: {
                textDocumentSync: { openClose: true, change: 1 },
                hoverProvider: true,
                codeActionProvider: true,
                executeCommandProvider: { commands: ['ubq.run'] },
              },
              serverInfo: { name: 'ubq' },
            },
          })
          return
        }
        case 'textDocument/didOpen':
          open.set(params.textDocument.uri, params.textDocument.text)
          publish(params.textDocument.uri)
          return
        case 'textDocument/didChange': {
          // Full sync: the last change has the full text.
          const text = params.contentChanges.at(-1)?.text
          if (typeof text === 'string') open.set(params.textDocument.uri, text)
          publish(params.textDocument.uri)
          return
        }
        case 'textDocument/didClose':
          open.delete(params.textDocument.uri)
          write({
            method: 'textDocument/publishDiagnostics',
            params: { uri: params.textDocument.uri, diagnostics: [] },
          })
          return
        case 'textDocument/hover': {
          const file = fileOf(params.textDocument.uri)
          const text = open.get(params.textDocument.uri)
          write({ id, result: file === undefined || text === undefined ? null : hoverOf(file, text, params.position) })
          return
        }
        case 'textDocument/codeAction': {
          const file = fileOf(params.textDocument.uri)
          const text = open.get(params.textDocument.uri)
          write({
            id,
            result: file === undefined || text === undefined ? [] : actionsOf(file, text, params.range.start.line),
          })
          return
        }
        case 'workspace/executeCommand': {
          if (params?.command !== 'ubq.run') break
          // A run of the tests, with this copy of ubq. The editor shows
          // the start and the summary line. The diagnostics change
          // when the run writes the store.
          const args = params.arguments as string[]
          write({ method: 'window/showMessage', params: { type: 3, message: `ubq run ${args.join(', ')}` } })
          const run = spawn(process.execPath, [process.argv[1]!, 'run', ...args], { cwd: projectRoot() })
          let output = ''
          run.stdout.on('data', (data: Buffer) => (output += data))
          run.stderr.on('data', (data: Buffer) => (output += data))
          run.on('close', code => {
            const message = output.trim().split('\n').at(-1)!
            write({ method: 'window/showMessage', params: { type: code ? 1 : 3, message } })
            write({ id, result: null })
          })
          return
        }
        case 'shutdown':
          ended = true
          write({ id, result: null })
          return
        case 'exit':
          for (const w of watchers) w.close()
          clearTimeout(timer)
          process.stdin.destroy()
          done(ended ? 0 : 1)
          return
      }
      // A request that the server does not know gets an error. A
      // notification that it does not know needs no answer.
      if (id !== undefined) write({ id, error: { code: -32601, message: `ubq lsp does not know ${method}` } })
    }

    let buffer = Buffer.alloc(0)
    process.stdin.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data])
      for (;;) {
        const end = buffer.indexOf('\r\n\r\n')
        if (end < 0) return
        const length = Number(/Content-Length: *(\d+)/i.exec(buffer.subarray(0, end).toString())?.[1])
        if (buffer.length < end + 4 + length) return
        const body = buffer.subarray(end + 4, end + 4 + length).toString()
        buffer = buffer.subarray(end + 4 + length)
        handle(JSON.parse(body) as Message)
      }
    })
    // The editor went away with no `exit`.
    process.stdin.on('end', () => handle({ method: 'exit' }))
  })
