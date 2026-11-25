// The DOM of a test file: the `dom` key of the configuration (D144).
// A test process calls `setDom` before the test file loads, so that
// a library that reads `document` when it loads finds it.
import { join } from 'node:path'
import { type Dom, domOf } from './config.ts'
import { projectRoot } from './project.ts'

/** The part of a window of jsdom or of happy-dom that this file uses. */
type Window = Record<string, unknown> & { document: { defaultView: unknown } }

// Names that the runtime has, and that the DOM has too. The DOM
// needs its own: an element takes only an event, a signal, or a
// file of its window.
const FROM_DOM = [
  'Event',
  'EventTarget',
  'CustomEvent',
  'MessageEvent',
  'CloseEvent',
  'ErrorEvent',
  'AbortController',
  'AbortSignal',
  'DOMException',
  'Blob',
  'File',
  'FormData',
  'Storage',
  'localStorage',
  'sessionStorage',
  'navigator',
  'Navigator',
  'WebSocket',
]
// happy-dom has its own fetch, which takes its own signals and forms.
const FETCH = ['fetch', 'Request', 'Response', 'Headers']

const HOOKS = Symbol.for('ubq.hooks')
const DONE = Symbol.for('ubq.dom')

type Global = Record<PropertyKey, unknown>

/**
 * Puts each name of the window on `globalThis`. A name that the
 * runtime has stays, if it is not in `replace`: the timers, `URL`,
 * `console`, and the builtins of JavaScript are those of the
 * runtime. A read of a name gives the value of the window at that
 * time, and a function of the window is bound to it.
 */
const populate = (window: Window, replace: string[]): void => {
  const global = globalThis as Global
  const names = new Set<string>()
  // `addEventListener` is on the prototype of the window.
  for (let o: object | null = window; o && o !== Object.prototype; o = Object.getPrototypeOf(o) as object | null)
    for (const name of Object.getOwnPropertyNames(o)) names.add(name)
  for (const name of names) {
    if (name === 'constructor' || /^(window|self|top|parent|globalThis)$/.test(name)) continue
    if (name in global && !replace.includes(name)) continue
    // The name of a class starts with a capital: it is not bound.
    // One bound function for a function: `removeEventListener ===
    // removeEventListener`.
    let from: unknown
    let to: unknown
    const bound = (value: unknown): unknown => {
      if (typeof value !== 'function' || /^[A-Z]/.test(name)) return value
      if (value !== from) to = (value as (...args: unknown[]) => unknown).bind(window)
      from = value
      return to
    }
    let own: { value: unknown } | undefined
    Object.defineProperty(global, name, {
      get: () => (own ? own.value : bound(window[name])),
      set: value => {
        own = { value }
      },
      configurable: true,
      enumerable: true,
    })
  }
  for (const name of ['window', 'self', 'top', 'parent']) global[name] = global
  // `element.ownerDocument.defaultView` is the place of the globals.
  Object.defineProperty(window.document, 'defaultView', { get: () => global, configurable: true })
}

/**
 * The `fetch` and the `Request` of the runtime take a signal of the
 * runtime. The `AbortController` of a test file with jsdom makes a
 * signal of jsdom. These take that signal too. `Controller` is the
 * class of the runtime, and `Signal` the class of jsdom. Each one is
 * made at its first read: a read of `Request` loads much code on
 * Node.
 */
const acceptSignals = (Controller: typeof AbortController, Signal: typeof AbortSignal): void => {
  const convert = <T extends RequestInit | undefined>(init: T): T => {
    const signal = init?.signal
    if (!signal || !(signal instanceof Signal)) return init
    const controller = new Controller()
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
    return { ...init, signal: controller.signal }
  }
  const lazy = <T>(name: 'fetch' | 'Request', make: (real: T) => T): void => {
    const real = Object.getOwnPropertyDescriptor(globalThis, name)!
    // The property of the runtime, with a different key: a read
    // of it is the first read of the name.
    const key = Symbol(name)
    Object.defineProperty(globalThis, key, real)
    let made: T | undefined
    Object.defineProperty(globalThis, name, {
      get: () => (made ??= make((globalThis as Global)[key] as T)),
      set: (value: T) => {
        made = value
      },
      configurable: true,
      enumerable: real.enumerable,
    })
  }
  lazy<typeof fetch>('fetch', real => (input, init) => real(input, convert(init)))
  lazy<typeof Request>(
    'Request',
    Real =>
      class Request extends Real {
        constructor(input: RequestInfo | URL, init?: RequestInit) {
          super(input, convert(init))
        }
      },
  )
}

/**
 * The hooks as globals. Testing Library, and other libraries of its
 * kind, look for a global `afterEach` when they load, and give it
 * the function that removes what a test rendered. The library of
 * ubq takes these hooks when it loads.
 */
const globalHooks = (): void => {
  const global = globalThis as Global
  const list = (global[HOOKS] ??= []) as [kind: string, fn: unknown][]
  for (const kind of ['beforeAll', 'afterAll', 'beforeEach', 'afterEach'])
    global[kind] ??= (fn: unknown) => void list.push([kind, fn])
}

/** The reason that a test process cannot make the DOM of the `dom` key, if it has one. */
export const domProblem = (dom: Dom): string | undefined => {
  // Deno 2.9 stops when a process with module hooks loads one of
  // these packages with `require`.
  if (process.versions.deno)
    // ubq: not measured: no test has the dom key on Deno
    return 'the "dom" key of "ubq" in package.json does not work on Deno: jsdom and happy-dom do not load in a test process of Deno. Run the test files that need a DOM on Node or on Bun.'
  try {
    process.getBuiltinModule('node:module').createRequire(join(projectRoot(), 'package.json')).resolve(dom.package)
    return undefined
  } catch {
    return `the "dom" key of "ubq" in package.json names the package ${dom.package}, and the project does not have it. Install it: npm install --save-dev ${dom.package}`
  }
}

/**
 * Makes the DOM of the test file, if the `dom` key has the file.
 * `file` is the path of the test file from the project root.
 */
export const setDom = (file: string | undefined): void => {
  const global = globalThis as Global
  const dom = file === undefined ? undefined : domOf(file)
  if (!dom || global[DONE]) return
  global[DONE] = true
  const problem = domProblem(dom)
  // ubq: not measured: the runner reports the problem before it starts a test process
  if (problem) throw new Error(problem)
  const url = dom.url ?? 'http://localhost:3000/'
  const load = process.getBuiltinModule('node:module').createRequire(join(projectRoot(), 'package.json'))
  if (dom.package === 'jsdom') {
    const { JSDOM } = load('jsdom') as { JSDOM: new (html: string, options: object) => { window: Window } }
    const jsdom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
      url,
      pretendToBeVisual: true,
    })
    const { AbortController: Controller } = globalThis
    populate(jsdom.window, FROM_DOM)
    acceptSignals(Controller, jsdom.window.AbortSignal as typeof AbortSignal)
    // As in jest and vitest: jsdom.reconfigure({ url }).
    global.jsdom = jsdom
  } else {
    const { Window } = load('happy-dom') as { Window: new (options: object) => Window }
    populate(new Window({ url, console: globalThis.console }), [...FROM_DOM, ...FETCH])
  }
  globalHooks()
}
