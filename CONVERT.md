# ubq guide: convert

How to move the tests of a project from tap, tape, ava, `node:test`, vitest,
jest, `bun:test`, mocha, or Playwright Test to `ubqtest`. This text comes from the installed
package. `ubq guide convert` prints it. Read `ubq guide` first: it
has the API and the rules of ubq.

## The steps

1. **Record the old result.** Run the old test command. Write
   down the count of tests that pass, and each test that fails or
   is skipped. You compare with this at the end.
2. **Install.** `npm install --save-dev ubqtest`, or the same
   command of the package manager that the project uses (`pnpm
   add -D ubqtest`): do not make a second lockfile. Then `npx ubq
   doctor`, and do each `FIX` line. A `note` line needs no action.
   If the user permits it, commit these changes, so that `git
   diff` in step 3 shows only the changes of the command. If you
   must not commit, go on: the diff then has the changes of this
   step too.
3. **Convert.** `npx ubq convert test` (give the folders and files
   that have tests). `--dry` shows the report and changes no file.
   The command changes the files in place. If `git status` is
   clean before it, `git diff` shows only its changes. It is safe to run the command again on one file. The
   command keeps the code correct, and then runs the formatter of
   the project (prettier, oxfmt, biome, or dprint) on the files
   that it changed. It finds the formatter in the `package.json`
   of the project, or of a folder around it. If the formatter is
   not installed or fails, a note gives the command to run by
   hand.
4. **Do each TODO.** The command writes `// TODO(ubq): ...` above
   each statement that it cannot change. If a file has the same
   text more than one time, only the first TODO has the full
   text, and the others have its first sentence. It makes only the changes
   that are correct in each case, so a TODO can be easy to do by
   hand: you can see what the code around it does, and the command
   cannot. `grep -rn 'TODO(ubq)'
   test` lists them. The sections below tell how to do each kind.
   Remove the comment when its statement is done. Move code, and
   do not type it again: a string can have characters that you
   cannot see.
5. **Run.** `npx ubq`. Do one failure at a time: `npx ubq
   <file>:<line>` runs one test. Read "Failures after the
   conversion" below before you change a test.
6. **Compare.** The count of tests that pass must be the count of
   step 1, or you must know the reason for each difference. A
   test that passed before and is skipped or removed now is a
   defect of the conversion.
7. **Clean up.** Set `"test": "ubq"`
   in the `scripts` of `package.json`. Remove the old test tool, its plugins, and its
   configuration (`.taprc`, `vitest.config.*`, `jest.config.*`,
   `.mocharc.*`, `c8` and `nyc` settings), and the entries for
   the old tool in `types` of `tsconfig.json`. The report of step
   3 names the files that still import the old tool, such as an
   `env.d.ts`: change them first. The old tool can bring packages
   that the project uses, such as `@types/node` or `typescript`:
   after you remove it, make sure that the build and the type
   check still work. Change the test command of CI. ubq needs
   Node 22.18 or later: if the CI matrix has an older version,
   tell the user, and do not remove it with no answer. The folder `.ubq/` has the run store, and git ignores it
   with no setup. Commit `ubq-snapshots/`.

Do not change the source of the project to make a test pass,
unless the test found a defect. Do not make an assertion weaker.

## What `ubq convert` changes

- The import of the old tool becomes `import { ... } from
  'ubqtest'`, with the names that the file uses.
- `it` becomes `test`. `describe` stays.
- An assertion with a certain form in ubq gets that form. The
  tables below list them.
- A message of an assertion becomes a comment at the end of its
  line. ubq prints the source line of a failed assertion, so the
  comment is in the failure report.
- `t.end()` and `t.plan(n)` go away. A test of ubq ends when its
  function ends.
- A promise that an assertion needs gets `await`, and its
  function becomes `async`.
- A tap test with subtests becomes `describe`.

It does not change the name of a file or the source of the
project. It changes `package.json` in two cases:

- For a project of the vitest plugin for Workers, it writes the
  `workers` key of the ubq configuration, if the key is not there.
- If the scripts are `"test": "tap"` and `"snap": "tap"` (or
  `"snapshot": "tap"`), they become `"test": "ubq"` and
  `"snap": "ubq --update"`. `npm run snap` writes snapshots, as it
  did with tap.

The report has one line for each TODO, with the number of a hint.
The full text of each hint is below the files, one time.

## Names of test files

ubq runs files whose names end in `.test.ts` (or `.test.js`,
`.test.mts`, `.test.tsx`, and so on). For tests with different
names, do one of these:

- Rename them: `test/parse.ts` to `test/parse.test.ts`.
- Add the pattern to `package.json`:
  `"ubq": { "include": ["test/**/*.ts"], "exclude": ["test/fixtures/**", "test/helpers/**"] }`.
  Each file that `include` finds must be a test file. A helper
  file with no tests is an error ("the file registered no
  tests"): put it in `exclude`.

## Imports of the source

- A test can import `'../src/parse.js'` or `'../src/parse'` when
  the file is `parse.ts`, and `'../src'` when the file is
  `src/index.ts`. ubq finds the file. The source of the project can
  import files in the same way. Do not change these imports, and
  do not write a loader for them.
- A test that imports the build output (`'../dist/index.js'`)
  works only after a build. Import the source (`'../src/index.ts'`):
  then a run needs no build, and coverage has the source lines.
- Node runs TypeScript with the types removed, and no other
  change. Source with `enum`, `namespace`, a decorator, or a parameter property
  (`constructor(private x: number)`) does not load. `ubq doctor`
  names the files that have such syntax. Node 26 has no option to
  run it. Stop, and ask the user to choose: change that syntax,
  run the tests on Bun (`bun node_modules/ubqtest/cli.js`), or
  test a build of the source (slower, and each run needs a build
  first). Do not choose for the user: a change of runtime or a
  build step is a surprise to a maintainer. With Bun or a build,
  the tsconfig does not set `erasableSyntaxOnly`: with that
  option, the type checker reports the syntax in each run.
  `ubq doctor` also says which of the files the tests import. If
  the user changes only those, do not set `erasableSyntaxOnly`:
  the other files still have the syntax.
- If the user chooses to change a `const enum` or an `enum` to
  an object, the change is in more than one file:

  ```ts
  export const Level = { Dirt: 0, Paved: 1 } as const
  export type Level = (typeof Level)[keyof typeof Level]
  ```

  The type has the name of the object, so `level: Level` still
  works. A member that is used as a type changes: `Level.Dirt`
  becomes `typeof Level.Dirt`. A plain `number` is not a `Level`:
  where the code made one from a number, add a check or a cast.
  Run the type checker, and correct each place that it names.
- If the old config has a time limit for each test (`testTimeout`
  of vitest), `ubq convert` prints a note with the `"timeout"` key
  to add. A test that takes more than its limit fails, also a
  test that does not await.
- Vite puts each value of its `define` in the source, such as
  `__DEBUG_BUILD__`. With ubq, the source throws `ReferenceError:
  __DEBUG_BUILD__ is not defined`. Give the values in the
  `define` key of the ubq configuration: `"ubq": { "define": {
  "__DEBUG_BUILD__": true } }`. ubq sets each one on `globalThis`
  before the test file loads. `ubq convert` writes the key from a
  vite or vitest config at the project root. If that config gets
  `define` from a different file, the command prints a note: then
  add the key by hand. Do not write a loader or a preload for it.
- ubq has no plugins: it runs each source file as it is. If a
  vite config has a plugin that changes the code that the tests
  run (it removes a block, or adds an import), `ubq convert`
  prints a note. Tell the user about it.
- A test file is an ES module. `ubq convert` changes `__dirname`
  and `__filename` to `import.meta.dirname` and
  `import.meta.filename`. It writes a TODO for `require(...)`,
  for an `enum`, and for a parameter property in a test file.
  Change these in the test file: this is not the source of the
  project.
- The type check of ubq reads the `tsconfig.json` of each folder
  from a test file up to the project root, and no other file
  name. If the project has the options of its tests in a file
  such as `tsconfig.test.json`, `ubq doctor` gives the
  `test/tsconfig.json` to add. Do not add the test files to the
  `tsconfig.json` of the source.
- In a package with no `"type": "module"`, Node prints the
  warning `MODULE_TYPELESS_PACKAGE_JSON` for each test file. The
  tests run. Do not add `"type": "module"` to stop the warning:
  it changes how the package loads for its users. Tell the user
  about it.

## tap

| tap | ubq |
| --- | --- |
| `t.test(name, async t => { ... })` | `test(name, async () => { ... })` |
| `t.equal(a, b)`, `t.is`, `t.strictEqual` | `assert.equal(a, b)` |
| `t.not(a, b)`, `t.notEqual` | `assert.notEqual(a, b)` |
| `t.same(a, b)`, `t.strictSame`, `t.deepEqual` | `assert.deepEqual(a, b)` |
| `t.notSame(a, b)`, `t.notStrictSame` | `assert(!isDeepEqual(a, b))` |
| `t.doesNotThrow(() => f())` | `f()` |
| `t.ok(a)`, `t.notOk(a)` | `assert(a)`, `assert(!a)` |
| `t.match(a, pattern)`, `t.has` | `assert.match(a, pattern)` |
| `t.throws(fn, expected)` | `assert.throws(fn, expected)` (`Error` if there was none) |
| `await t.rejects(p, expected)` | `await assert.rejects(p, expected)` |
| `t.resolveMatch(p, pattern)` | `assert.match(await p, pattern)` |
| `t.type(a, 'string')`, `t.type(a, Class)` | `assert.equal(typeof a, 'string')`, `assert(a instanceof Class)` |
| `t.error(err)` | `assert(!err)` |
| `t.pass()`, `t.fail(msg)` | `assert(true)`, `assert.fail(msg)` |
| `t.matchSnapshot(a)` | `assert.snapshot(a)` |
| `t.teardown(fn)`, `t.after(fn)` | `cleanup(fn)` |
| `t.testdir({ ... })` | `testdir({ ... })` |
| `t.mockImport('../a.js', { '../b.js': { f } })` | `mockImport(() => import('../a.js'), [[() => import('../b.js'), { f }]])` |
| `t.comment(...)` | `console.log(...)` |
| `t.end()`, `t.plan(n)` | removed |
| `t.end()` in a callback | `end()`, and the test returns `new Promise(end => { ... })` |

Things to check by hand:

- **`t.same` and `t.match` are loose in tap.** `t.same` compares
  with `==` for values and ignores the prototype. `assert.deepEqual`
  is strict. If a converted `deepEqual` fails on a difference such
  as `1` and `'1'`, or a class instance and a plain object, the
  old test was loose. Change the expected value to the exact
  value. Use `assert.match(a, { ... })` when the test must check
  only some keys.
- **A test with subtests.** ubq has no test in a test. The outer
  test becomes `describe`. Code in the outer test that is not in
  a subtest ran one time, before the subtests. In a `describe`,
  that code runs when the file loads. Setup that makes values is
  fine there. Move each assertion into a `test`. Move setup that
  must be new for each test into a function, and call it in each
  test.
- **Assertions at the top level of the file.** Put them in a
  `test('name', () => { ... })`.
- **When a test runs.** A tap subtest ran at its place in the
  file. A ubq test runs after the whole file loaded. A test that
  reads a variable that the file changes later sees the last
  value. Copy the value when you call `test()`: `const f =
  [...files]`.
- **A message that names the case.** ubq assertions have no
  message. A text message becomes a comment. A message that an
  expression makes, often in a loop, gets a TODO: make one test
  for each case, with the case in the name of the test.
- **`t.fail` in a loop, then `t.pass`.** Collect the wrong values
  in a list in the loop, and `assert.deepEqual(wrong, [])` after
  it. `assert(true)` cannot fail.
- **`t.plan(n)`.** A plan made sure that callbacks ran. With
  `async` and `await`, the test function waits for them. If the
  test has a callback API, wrap it in a promise and `await` it.
  A test with zero assertions fails in ubq, so a callback that
  never runs is found.
- **`t.beforeEach`, `t.afterEach`, `t.before`.** See "Hooks".
- **`t.capture`, `t.intercept`, `t.captureFn`.** Use
  `spyOn(object, key, impl?)`, then read `spy.calls`.
- **`t.mockImport` with keys or values that are not literals,
  `t.mockRequire`, `t.mock`.** Write `mockImport` by hand. The
  mock must have the types of the real exports. `mockRequire` of a
  CommonJS module: import the module with `mockImport` in the
  same way.
- **`t.context`.** Make the values in a setup function and return
  them.
- **Snapshots.** tap keeps them in `tap-snapshots/`. ubq keeps
  them in `ubq-snapshots/`, in a different form. When the tests
  pass with the old tool, run `npx ubq --update`, read the new
  files, and remove `tap-snapshots/`. Until then, `ubq doctor`
  names its files: their names end in `.test.cjs`.
- **`t.skip`, `{ skip: true }`, `{ todo: true }`.** Give the
  reason as text: `test(name, { skip: 'needs a GPU' }, fn)`.
- **Coverage settings.** tap fails a run with less than full
  coverage. ubq has no such limit. `npx ubq uncovered` lists the
  code that no test ran. ubq does not read `c8 ignore` or
  `istanbul ignore` comments, and the report of `ubq convert`
  names them. At each range that no test can run, write `// ubq:
  not measured: <reason>`.
- **A fixture or helper that uses `t`.** A helper function that
  gets `t` as an argument must import `assert` from `ubqtest` and
  must not get `t`.

## tape

`ubq convert` changes a tape file with the rules of tap: the
table above, and the other names that tape has for each
assertion. Read "Things to check by hand" of tap too. More for
tape:

| tape | ubq |
| --- | --- |
| `test(name, t => { ... })` | `test(name, () => { ... })` |
| `t.notDeepEqual(a, b)` | `assert(!isDeepEqual(a, b))` |
| `t.doesNotMatch(text, /re/)` | `assert.equal(text.match(/re/), null)` |
| `t.timeoutAfter(ms)` | TODO: `test(name, { timeout: ms }, fn)` |

- **A test that ends in a callback.** A tape test ends at
  `t.end()`, or after the count of assertions of `t.plan(n)`. A
  ubq test ends when its function ends, or when the promise that
  it returns resolves. For a `t.end()` in a callback, `ubq
  convert` makes the test return a promise, and the callback
  resolves it:

  ```ts
  test('reads the file', () => new Promise<void>(end => {
    readFile(path, (error, data) => {
      assert(!error)
      assert.equal(String(data), 'text')
      end()
    })
  }))
  ```

  It writes a TODO, and does not make this change, if the test
  function is async or uses `this`, or if the call has an
  argument (`t.end(error)`).
- **`t.plan(n)` with no `t.end()`.** The command writes a TODO at
  a `t.plan(n)` of a test that uses the test object in a
  function. If that function runs later, make the test return a
  promise in the same form, and call `end()` after the last
  assertion. If it runs before the test function returns (a loop
  helper), delete the `t.plan(n)` line.
- **`t.looseEqual` and `t.deepLooseEqual`** compare with `==`.
  They become `assert.deepEqual`, which is strict.
- **`test.onFinish(fn)`.** At the top level of the file,
  `cleanup(fn)` runs `fn` when the file ends.

## ava

| ava | ubq |
| --- | --- |
| `test(name, async t => { ... })`, `test.serial` | `test(name, async () => { ... })` |
| `t.is(a, b)`, `t.not(a, b)` | `assert.equal(a, b)`, `assert.notEqual(a, b)` |
| `t.deepEqual(a, b)`, `t.notDeepEqual(a, b)` | `assert.deepEqual(a, b)`, `assert(!isDeepEqual(a, b))` |
| `t.like(a, { ... })` | `assert.match(a, { ... })` |
| `t.truthy(a)`, `t.assert(a)`, `t.falsy(a)` | `assert(a)`, `assert(!a)` |
| `t.true(a)`, `t.false(a)` | `assert.equal(a, true)`, `assert.equal(a, false)` |
| `t.regex(text, /re/)`, `t.notRegex(text, /re/)` | `assert.match(text, /re/)`, `assert.equal(text.match(/re/), null)` |
| `t.throws(fn)` | `assert.throws(fn, Error)` |
| `t.throws(fn, { instanceOf: TypeError })` | `assert.throws(fn, TypeError)` |
| `t.throws(fn, { message: 'text', code: 'E' })` | `assert.throws(fn, { message: 'text', code: 'E' })` |
| `await t.throwsAsync(p, expected)` | `await assert.rejects(p, expected)` |
| `t.notThrows(() => f())`, `await t.notThrowsAsync(p)` | `f()`, `await p` |
| `t.snapshot(a)` | `assert.snapshot(a)` |
| `t.teardown(fn)` | `cleanup(fn)` |
| `t.pass()`, `t.fail(msg)` | `assert(true)`, `assert.fail(msg)` |
| `t.log(...)` | `console.log(...)` |
| `t.plan(n)` | removed |
| `test.todo(name)` | `test(name, { skip: 'todo' }, () => {})` |

Things to check by hand:

- **Tests run one after the other.** ava runs the tests of a
  file at the same time. ubq runs them in the order of the file,
  as `test.serial` does.
- **`t.context` and hooks.** ubq has no hooks and no context.
  Make a setup function that returns the values, and call it in
  each test: see "Hooks" below. `test.after.always(fn)` is
  `cleanup(fn)` at the top level of the file.
- **`t.throws` with a class and other keys.** `assert.throws`
  takes a class or a partial object, not the two. It returns the
  error: `const error = assert.throws(fn, { message: 'text' })`,
  then `assert(error instanceof TypeError)`. The key `is` of ava
  is `assert.equal(error, expected)`.
- **Macros.** `test(name, macro, a, b)` has a TODO. Make the
  macro a plain function with `assert` of `ubqtest` in it, and
  call it: `test(name, () => macro(a, b))`.
- **`test.failing`.** ubq has no test that must fail. Assert on
  the wrong behavior, or skip the test with a reason.
- **`t.timeout(ms)`** is the option `{ timeout: ms }` of `test`.
- **Snapshots.** ubq does not read the `.snap` files of ava. Read
  the `.md` report of each old snapshot, run `ubq --update`, and
  compare the new files with the reports. Then delete the old
  files.
- **`t.try`.** ubq has no form of it.

## node:test and node:assert

| node | ubq |
| --- | --- |
| `it`, `test` from `node:test` | `test` |
| `assert.strictEqual`, `assert.equal` | `assert.equal` |
| `assert.deepStrictEqual`, `assert.deepEqual` | `assert.deepEqual` |
| `assert.notStrictEqual` | `assert.notEqual` |
| `assert.notDeepStrictEqual(a, b)`, `assert.notDeepEqual(a, b)` | `assert(!isDeepEqual(a, b))` |
| `assert.ok(a)` | `assert(a)` |
| `assert.throws(fn)`, `assert.rejects(p)` | the same with `Error` as the expected error |
| `assert.ifError(err)` | `assert(!err)` |
| `mock.fn(impl)`, `mock.method(object, key)` | `spy(impl)`, `spyOn(object, key)` |

Things to check by hand:

- **`assert.equal` and `assert.deepEqual` from `node:assert`
  (not strict) are loose.** In ubq they are strict.
- **`assert.doesNotThrow(fn)`.** Call the function, and assert on
  its result.
- **`assert.doesNotMatch`.** Write the condition:
  `assert(!pattern.test(text))`.
- **The test object `t`.** `t.mock.fn()` is `spy()`. `t.after(fn)`
  is `cleanup(fn)`. `t.test(...)` is a subtest: use `describe`.
  `t.diagnostic(text)` is `console.log(text)`. `t.skip()` in a
  test: use `{ skip: condition && 'the reason' }`.
- **`before`, `after`, `beforeEach`, `afterEach`.** See "Hooks".
- **`mock.timers`.** Use `fakeClock`.

## vitest, jest, and bun:test

`bun:test` has the `expect` of jest. This table is for it too.

| vitest, jest, bun:test | ubq |
| --- | --- |
| `it`, `test` | `test` |
| `expect(a).toBe(b)` | `assert.equal(a, b)` |
| `expect(a).toEqual(b)`, `toStrictEqual` | `assert.deepEqual(a, b)` |
| `expect(a).not.toBe(b)` | `assert.notEqual(a, b)` |
| `toBeTruthy()`, `toBeFalsy()` | `assert(a)`, `assert(!a)` |
| `toBeNull()`, `toBeUndefined()`, `toBeDefined()` | `assert.equal(a, null)`, `assert.equal(a, undefined)`, `assert.notEqual(a, undefined)` |
| `toContain(b)`, `not.toContain(b)`, `toHaveLength(n)` | `assert.contains(a, b)`, `assert.notContains(a, b)`, `assert.equal(a.length, n)` |
| `toMatch(/re/)`, `toMatch('text')` | `assert.match(a, /re/)`, `assert.contains(a, 'text')` |
| `toMatchObject(o)` | `assert.match(a, o)` |
| `toBeInstanceOf(C)` | `assert(a instanceof C)` |
| `toBeInTheDocument()`, `not.toBeInTheDocument()` | `assert(el.isConnected)`, `assert(!el?.isConnected)` |
| `toHaveAttribute(name)`, `toHaveAttribute(name, v)` | `assert(el.hasAttribute(name))`, `assert.equal(el.getAttribute(name), v)` |
| `toHaveTextContent('text')`, `toHaveTextContent(/re/)` | `assert.contains(el.textContent, 'text')`, `assert.match(el.textContent, /re/)` |
| `toHaveClass('name')` | `assert(el.classList.contains('name'))` |
| `toBeDisabled()`, `toBeEnabled()`, `toBeChecked()` | `assert(el.matches(':disabled'))`, `assert(!el.matches(':disabled'))`, `assert(el.matches(':checked'))` |
| `toHaveFocus()` | `assert.equal(document.activeElement, el)` |
| `fail('text')` (a global of jest) | `assert.fail('text')` |
| `toBeGreaterThan(b)`, `toBeLessThan(b)` | `assert.greaterThan(a, b)`, `assert.lessThan(a, b)` |
| `toBeGreaterThanOrEqual(b)`, `toBeLessThanOrEqual(b)` | `assert.greaterThanOrEqual(a, b)`, `assert.lessThanOrEqual(a, b)` |
| `toBeCloseTo(b)`, `toBeCloseTo(b, digits)` | `assert.close(a, b)`, `assert.close(a, b, digits)` |
| `expect(fn).toThrow(x)` | `assert.throws(fn, x)` (a text becomes a RegExp, and an Error instance becomes `{ message: error.message }`) |
| `await expect(p).rejects.toThrow(x)` | `await assert.rejects(p, x)` |
| `await expect(p).rejects.toBeInstanceOf(C)`, `rejects.toMatchObject(o)` | `await assert.rejects(p, C)`, `await assert.rejects(p, o)` |
| `await expect(p).resolves.toEqual(b)` | `assert.deepEqual(await p, b)` |
| `toHaveBeenCalled()`, `toHaveBeenCalledTimes(n)` | `assert(s.calls.length > 0)`, `assert.equal(s.calls.length, n)` |
| `not.toHaveBeenCalled()` | `assert.equal(s.calls.length, 0)` |
| `toHaveBeenCalledWith(...args)` | `assert.deepEqual(s.calls.at(-1)?.args, [...args])` |
| `not.toHaveBeenCalledWith(...args)` | `assert(!s.calls.some(call => isDeepEqual(call.args, [...args])))` |
| `toHaveBeenNthCalledWith(2, ...args)` | `assert.deepEqual(s.calls[1]?.args, [...args])` |
| `toHaveBeenCalledExactlyOnceWith(...args)` | `assert.equal(s.calls.length, 1)`, then `assert.deepEqual(s.calls[0]?.args, [...args])` |
| `toBeCalled`, `toBeCalledTimes`, `toBeCalledWith`, `lastCalledWith`, `nthCalledWith` | as `toHaveBeenCalled` and the others |
| `toBeTypeOf('string')` | `assert.equal(typeof a, 'string')` |
| `toMatchSnapshot()` | `assert.snapshot(a)` |
| `vi.fn(impl)`, `jest.fn(impl)` | `spy(impl)` |
| `vi.spyOn(object, key)` | `spyOn(object, key)` |
| `it.skip(name, fn)` | `test(name, { skip: 'the reason' }, fn)` |
| `it.todo(name)` | `test(name, { skip: 'todo' }, () => {})` |
| `it(name, fn, 10000)` | `test(name, { timeout: 10000 }, fn)` |

Things to check by hand:

- **`toEqual` is loose.** It ignores keys with the value
  `undefined` and ignores the class. `assert.deepEqual` is
  strict. Use the exact value, or `assert.match` for some keys.
- **`toHaveBeenCalledWith`.** jest passes if any call had the
  arguments. With one such check of a spy in a function, the
  converted line checks the last call. If the call is not the last
  one, use the index of the call, or the form for any call. With
  two or more checks of one spy in a function, the command writes
  the form for any call:
  `assert(s.calls.some(call => isDeepEqual(call.args, [...args])))`.
- **`rejects` with a matcher that is not in the table**
  (`rejects.toBe(error)`, `rejects.toEqual(...)`). The command
  writes a TODO. `assert.rejects` gives the value that the promise
  rejects with: `const error = await assert.rejects(p, Error)`,
  then `assert.equal(error, expected)`.
- **`vi.spyOn(module, 'name')`, where `module` is `import * as
  module`.** The exports of a module cannot change, so `spyOn`
  cannot replace one. The command leaves the call with a TODO.
  Use `mockImport` (see `vi.mock` below). The mock must have each
  export that the code under test imports, so spread the real
  module: `{ ...module, name: spy(impl) }`. A converted assertion
  on a name of such a module (`assert(name.calls.length > 0)`)
  gets a TODO too: the name is the real export, not a spy. Assert
  on the spy that the mock has.
- **`expect.any`, `expect.objectContaining`, `expect.anything`.**
  `assert.match` with a partial object does the work of
  `objectContaining`. A function in a pattern does the work of
  `any` and `anything`. In a pattern (`toMatchObject`, an object
  for `toThrow`), the command writes it: `expect.any(Number)`
  becomes `(v: unknown) => typeof v === 'number'`,
  `expect.any(URL)` becomes `(v: unknown) => v instanceof URL`,
  and `expect.anything()` becomes `(v: unknown) => v != null`.
  In an exact comparison (`toEqual`, `toHaveBeenCalledWith`) the
  matcher stays, with a TODO: `assert.deepEqual` compares a
  function as a value. Change that assertion to `assert.match`
  with the functions. It permits keys that the pattern does not
  have.
  `expect.stringContaining('text')` becomes a RegExp only in a
  pattern (`toMatchObject`, `toThrow`). In an exact comparison
  (`toEqual`, `toHaveBeenCalledWith`) it stays, with a TODO: a
  RegExp is not equal to a string there. Assert on that value by
  itself: `assert.contains(s.calls.at(-1)?.args[0], 'text')`.
- **`toContainEqual(b)`.** The command writes
  `assert(list.some(item => isDeepEqual(item, b)))`.
  `isDeepEqual` gives true or false by the rules of
  `assert.deepEqual`. Use it also for `expect.arrayContaining`
  with objects.
- **`expect.arrayContaining` of literals.** The command writes
  `assert.contains(list, x)` for each literal, when `list` is a
  name or a path of names (`res.names`).
- **`it.each(table)`.** A `for` loop around `test()`.
  `describe.each(table)` is a `for` loop around `describe()`.
  `ubq convert` makes the loop when the table is an array of
  arrays, of objects, or of single values, and each value that the
  name uses (`%s`, `%d`, `%i`, `%j`, `$key`) is a literal. `%#` and
  `$#` become the index. If two rows give one name, the command
  adds the index: `row x (0)`. The types of the parameters go on
  the table: `as [number, string][]`. For each other form, the
  command writes a TODO. Then each test name must be different:
  put the value in the name. `%s` of an object is `[object
  Object]`, and `%j` of `NaN` and of `null` are both `null`: use
  `JSON.stringify(value)`, or the index.
- **`it.skipIf(condition)`, `it.runIf(condition)`.** An option:
  `test(name, { skip: condition && 'the reason' }, fn)`. For
  `runIf`: `!condition`.
- **`expect.assertions(n)`, `expect.hasAssertions()`.** Delete
  them. A test with no assertion fails. If an assertion is in a
  callback, make the test wait for the callback: wrap it in a
  promise, await it, then assert on the values.
- **`not.toThrow()`.** Call the function, then assert on its
  result. For a function with no result, assert on what it
  changed, or on the calls of a spy.
- **`toHaveProperty('a.b')`** is a path of keys:
  `assert('b' in x.a)`. A key with no dot becomes
  `assert(Reflect.has(Object(x), 'k'))`.
- **`toMatchInlineSnapshot(text)`.** ubq has no inline snapshot.
  For a string, `assert.equal(value, text)`. For another value,
  `assert.snapshot(value)`, then `ubq --update <file>`: check that
  the new snapshot has the old text.
- **`.only`.** The command removes it. ubq runs one test from the
  command line.
- **`vi.mock(path)`, `jest.mock(path)`.** These change the module
  for the whole file. `mockImport` gives a new instance of the
  module under test with its dependency replaced, in one test:

  ```ts
  const { checkout } = await mockImport(() => import('../src/cart.ts'), [
    [() => import('../src/payment.ts'), { charge: spy(async () => ({ id: 'r1' })) }],
  ])
  ```

  The test then uses `checkout` from that instance, not from the
  import at the top of the file.

  - The mock must have each export of the dependency that the
    code under test imports. To change only some, spread the real
    module: `{ ...(await import('../src/payment.ts')), charge }`.
  - The mock replaces the dependency in each project module that
    the new instance imports, at each depth.
  - Each call gives a new instance of the module under test and of
    the project modules that it imports. A class or an object of
    that instance is not the one of the import at the top of the
    file: `instanceof` with the class of the top import is false.
    To spy on a module that the code shares, such as a logger, put
    that module in the list too.
  - A module with state that the test and the code under test
    must share needs the same: a React context, a store, a client
    that the module makes one time. The new instance has its own
    copy, so a provider of the test file and a consumer of the new
    instance do not see each other, and a "was not called" check
    passes for the wrong reason. Give the copy of the test file as
    the mock, with all its exports:
    `[() => import('../src/context.ts'), await import('../src/context.ts')]`.
  - A package of the same monorepo that the package manager links
    (pnpm, npm workspaces) is a project module for `mockImport`,
    not a package in `node_modules`: each call loads it again. If
    that is slow, or if its state must be the same, give it as a
    mock in the same form.
  - `vi.mocked(x)` only changes the type of `x`. Use the spy that
    you gave to the mock.
- **`mockReturnValue`, `mockResolvedValue`, `mockImplementation`.**
  A spy gets its implementation when it is made: `spy(() => 1)`,
  `spy(async () => value)`. The command converts a call that is
  on the line that makes the spy. For a call on a later line, or
  for a different result in each call, write the logic in the
  implementation. In one test, a second `spyOn` on the same key
  replaces the first. A spy does not change after it is made.
  The forms:

  | vitest | ubq |
  | --- | --- |
  | `s.mockReturnValue(v)` on a later line | `let result = first; const s = spy(() => result)`, then `result = v` |
  | `s.mockReturnValueOnce(a).mockReturnValueOnce(b)` | `const results = [a, b]; const s = spy(() => results.shift())` |
  | `s.mockImplementationOnce(f)` | `let once: typeof impl \| undefined = f; const s = spy((...args) => { const now = once ?? impl; once = undefined; return now(...args) })` |
  | `s.mockClear()`, `s.mockReset()` | `s.calls.length = 0`, or a new spy in each test |

  A spy from a shared helper, or at the top level of a file, lives
  until the file ends. Make it in a function that each test
  calls, so that each test gets a new one.
- **`fn.mock.calls[0]`** is `fn.calls[0]?.args`.
  `fn.mock.results[0].value` is `fn.calls[0]?.result`.
- **`vi.restoreAllMocks()`, `mockRestore()`.** A `spyOn` spy goes
  back when its test ends. ubq has no call that puts the method
  back before that. The command removes a hook that only
  restores, and each call. A call that is not at the end of a
  test gets a TODO: if the code after it needs the real method,
  move that code to a new test. A helper of the project can give
  a restore function (`restore: () => spy.mockRestore()`), and a
  test file can assign it to a variable that a hook calls
  (`restore = m.restore`, with `afterEach(() => restore())`). If
  the helper and the test files are in the same run, the command
  removes the variable, the hook, and each assignment. It removes
  the function from the helper if no other code of the run reads
  it. Else a TODO stays at the hook or at the function.
- **Fake timers.** Make the clock in the test that uses it, or
  in a setup function that each test calls. The clock goes back
  when the test ends.

  | vitest | ubq |
  | --- | --- |
  | `vi.useFakeTimers()` | `const clock = fakeClock()` |
  | `vi.setSystemTime(t)` at the start | `fakeClock({ now: t })` |
  | `vi.setSystemTime(t)` later | `clock.set(t)` |
  | `vi.advanceTimersByTime(ms)`, `advanceTimersByTimeAsync` | `await clock.tick(ms)` |
  | `vi.runAllTimers()`, `runOnlyPendingTimers`, and their async forms | `await clock.runAll()` |
  | `vi.useRealTimers()` | delete it, or `clock.restore()` before the end of the test |

  `fakeClock()` starts at the real time. `fakeClock({ now: 0 })`
  starts at 0, and code that subtracts from `Date.now()` then gets
  a value below 0.
- **`vi.clearAllMocks()`, `vi.resetAllMocks()`, `mockClear()`.**
  A spy that a test makes is new in each test: delete the call. A
  spy at the top level of the file keeps its calls from test to
  test: make it in the test or in a setup function. To forget the
  calls of a spy in a test: `s.calls.length = 0`.
- **`vi.stubGlobal(name, value)`.** `ubq convert` makes it
  `stub(globalThis, name, value)`, and `vi.stubEnv(name, value)`
  `env({ [name]: value })`. Both put the old value back when the
  test ends. Delete `vi.unstubAllGlobals()` and
  `vi.unstubAllEnvs()`. If the type checker reports a fake value
  with too few properties, cast it: `{ userAgent: 'x' } as
  Navigator`.
- **`vi.waitFor(fn)`, `vi.waitUntil(fn)`.** `await
  assert.eventually(() => value, pattern)`.
- **`vi.resetModules()` with a dynamic import.** `await
  mockImport(() => import('../src/a.ts'), [])` gives a new
  instance of the module.
- **`beforeEach` and the other hooks.** See "Hooks".
- **Globals.** jest gives `describe`, `it`, and `expect` with no
  import. ubq has no globals. The command adds the import.
- **A DOM (jsdom, happy-dom).** ubq has no test environment. The
  command writes a TODO in a file with an `@vitest-environment`
  or `@jest-environment` comment for jsdom or happy-dom. Make the
  DOM in each test that needs it. `stub` puts each global back
  when the test ends:

  ```ts
  import { JSDOM } from 'jsdom'
  import { cleanup, stub } from 'ubqtest'

  const dom = () => {
    const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
    for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Event'] as const)
      stub(globalThis, name, window[name] as never)
    cleanup(() => window.close())
    return window
  }

  test('a click', () => {
    dom()
    const button = document.createElement('button')
    // ...
  })
  ```

  Add each global that the code under test reads to the list.
  Put the function in a helper file if more than one test file
  needs it. Delete the environment comment.
- **Testing Library (`@testing-library/react` and the others).**
  The library reads `document` when it loads, so a DOM that one
  test makes is too late. Make the DOM one time for the test
  file, in a helper file that then loads the library. The
  command writes a TODO in each file that imports the library.
  Each test file is its own process, so the DOM of one file is
  not the DOM of a second file.

  ```ts
  // test/dom.ts
  import { JSDOM } from 'jsdom'
  import { cleanup } from 'ubqtest'

  const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
  // Each name of the window that the test process does not have.
  for (const name of Object.getOwnPropertyNames(window))
    if (!(name in globalThis))
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get: () => window[name as keyof typeof window],
      })

  // After the lines above: the library reads `document` now.
  const library = await import('@testing-library/react')

  export const { screen, fireEvent, waitFor, act } = library
  /** Renders, and removes what it made when the test ends. */
  export const render: typeof library.render = (...args: Parameters<typeof library.render>) => {
    cleanup(library.cleanup)
    return library.render(...args)
  }
  ```

  A test file imports `render` and `screen` from `./dom.ts`, not
  from the library. jest and vitest remove each tree after each
  test with a hook. Here `render` does it with `cleanup()`. A
  `.tsx` test file needs Bun or Deno: Node does not run JSX. If
  jsdom is in the project only because jest brought it, add it:
  `npm install --save-dev jsdom`.
- **jest-dom (`toBeInTheDocument` and the others).** The command
  changes the checks of the table above. The others have a TODO:
  read the property of the element, and assert on it. An element
  that a `queryBy` function did not find is `null`. For a test of real
  browser behavior (layout, focus, navigation), tell the user
  about browser tests: "Tests in a browser" in `ubq guide`.
- **A custom environment, a transform.** ubq has none. Tell the
  user about each test file that needs one.
- **A Cloudflare Worker (`cloudflare:test`,
  `@cloudflare/vitest-pool-workers`).** These tests run in the
  Workers runtime with ubq too. Read "Tests of a Cloudflare
  Worker" in `ubq guide`. The command reads `vitest.config.*` of
  the project and writes the `workers` key to `package.json`: one
  entry for each project of the config, with its wrangler config,
  its test files, and the plain values of `miniflare.bindings` as
  `vars`. Read the notes that it prints: a value that is not plain
  must go into `vars` by hand. Each other key of `miniflare`
  (such as `serviceBindings`) gets a note: ubq uses the wrangler
  config for them. A binding for the D1 migrations
  (`TEST_MIGRATIONS: await readD1Migrations(...)`) gets no note
  and is not in `vars`: `migrate` does that work. If the project
  has a copy of its wrangler config for the tests, which leaves
  out `containers` or a service binding, the copy is not
  necessary: ubq loads a config with them. A service binding to
  a Worker that is not this one answers `fetch` with 503. A test
  that checks that status can need a change. If a setup file of the config only
  applied D1 migrations, the command adds `await migrate('DB')`
  to each test file of that project, and says that the setup file
  can go. The command also changes these names of
  `cloudflare:test`:

  | vitest plugin | ubq |
  | --- | --- |
  | `env` from `cloudflare:test` | `env` from `cloudflare:workers` |
  | `createExecutionContext()` | `executionContext()` |
  | `await waitOnExecutionContext(ctx)` | `await ctx.settled()` |
  | `createScheduledController(options)` | `scheduledController(options)` |
  | `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` | `await migrate('DB')` |

  ubq has no `SELF`, `fetchMock`, `runInDurableObject`, or the
  other names: write the test without them. Values that the
  vitest config gave to the tests (`miniflare.bindings`) go in
  `vars` of the `workers` entry in the ubq configuration.
  The plugin gave each test its own storage. ubq gives each
  test file its own storage. A setup file of the vitest config
  (`setupFiles`) becomes a module that exports a function, and
  each test file awaits that function at its top level. The
  module cannot do the work when it loads: workerd permits I/O
  at the top level only in the test file itself. For D1
  migrations, the line is `await migrate('DB')` in each test
  file.

## mocha

The command converts `describe` and `it` with `node:assert`. It
does not convert `chai` or `sinon`. Write those assertions by hand
with the tables above. The command does not change
`this.timeout(ms)`, and writes no TODO for it. Change it by hand
to `test(name, { timeout: ms }, fn)`.

## Playwright Test

For tests that import from `@playwright/test`. ubq has the page
of Playwright, with Chromium: `browser()` from
`'ubqtest/browser'`. Read "Tests in a browser" in `ubq guide`
first. The project needs `playwright-core`, and `npx ubq browser
install`. After the conversion, remove `@playwright/test`.

| Playwright Test | ubq |
| --- | --- |
| `test(name, async ({ page }) => { ... })` | `test(name, async () => { const page = await browser() ... })` |
| `async ({ page, context }) =>` | `const page = await browser()`, `const context = page.context()` |
| `test.describe(name, fn)`, `test.describe.serial`, `test.describe.parallel` | `describe(name, fn)` |
| `await expect(locator).toHaveText('a')`, `toHaveText(/a/)` | `await assert.eventually(() => locator.textContent(), 'a')` |
| `await expect(locator).toHaveText(['a', 'b'])` | `await assert.eventually(() => locator.allTextContents(), ['a', 'b'])` |
| `await expect(locator).toContainText('a')` | `await assert.eventually(() => locator.textContent(), /a/)` |
| `toBeVisible()`, `toBeHidden()`, `toBeEnabled()`, `toBeDisabled()`, `toBeChecked()`, `toBeEditable()` | `await assert.eventually(() => locator.isVisible(), true)`, and the same with `isHidden`, `isEnabled`, `isDisabled`, `isChecked`, `isEditable` |
| `not.toBeVisible()` and the others of that row | `await assert.eventually(() => locator.isVisible(), false)` |
| `toHaveCount(n)`, `toHaveValue(v)`, `toHaveAttribute(name, v)` | `assert.eventually` with `locator.count()`, `locator.inputValue()`, `locator.getAttribute(name)` |
| `await expect(page).toHaveTitle(t)`, `toHaveURL(u)` | `await assert.eventually(() => page.title(), t)`, `() => page.url(), u` |
| `await expect.poll(fn).toBe(value)` | `await assert.eventually(fn, value)` |
| `expect(value).toBe(x)`, `expect.soft(value)`, and the other checks of a value | the forms of "vitest, jest, and bun:test" above |
| `import { type Page, devices } from '@playwright/test'` | the same names from `'playwright-core'` |

Things to check by hand:

- **`toHaveText` with text.** Playwright removes the spaces at
  the ends of the text of the element, and makes each group of
  spaces between words one space. `locator.textContent()` gives
  the text as it is. If the new check fails with spaces or line
  ends in the actual value, use a RegExp, or read
  `locator.innerText()`. Do not remove the check.
- **The time limit of a check.** `assert.eventually` waits 2000
  ms. A check of Playwright waits 5000 ms, or the time of its
  `{ timeout }` option. A check with that option has a TODO. If
  the page needs more than 2000 ms, wait for the cause first, such
  as `await page.waitForResponse(...)`, then assert.
- **Hooks.** `test.beforeEach(async ({ page }) => { ... })` has a
  TODO. Make a function that opens the page, and call it in each
  test:

  ```ts
  const open = async () => {
    const page = await browser()
    await page.goto('/count.html')
    return page
  }
  ```

  The command puts `const page = await browser()` in each test
  that had `page`. Change that line to `const page = await
  open()`.
- **Other fixtures.** A test that gets `request`, `browser`,
  `browserName`, or a fixture that the project made with
  `test.extend` has a TODO. For `request`, use `fetch`. For a
  fixture of the project, call a function in the test, with
  `cleanup()` for its end.
- **`playwright.config`.** ubq does not read it. The command
  prints a note with the `"browser"` key for `baseURL` and
  `webServer`: `"ubq": { "browser": { "url": "http://localhost:4173",
  "command": "npm run preview" } }`. Options of a context, such as
  `viewport` and `locale` of `use` or of `test.use`, are the
  argument of `browser()`. ubq runs the tests in Chromium only: if
  the config has a project for Firefox or WebKit, tell the user.
- **Tests run one at a time in a file**, and each test has a new
  context. Test files run at the same time, as the workers of
  Playwright do.
- **`test.step`, `test.setTimeout`, `test.slow`, and a
  `test.skip(condition, reason)` in a test** have a TODO. A step is
  code of the test with a comment. The time limit and the skip
  are options of `test`.
- **Screenshots, traces, and video.** ubq keeps none. `toHaveScreenshot`
  has no form in ubq: tell the user, and do not remove the test
  with no answer.
- **The names of the files.** Playwright Test runs `*.spec.ts`.
  ubq runs `*.test.ts`: rename the files, or set `"include"`.

A test that uses the Playwright library with a different test tool
(`chromium.launch()` in a vitest file) converts as a test of that
tool. The launch has a TODO: `browser()` starts the browser, and
closes the page when the test ends.

## Hooks

ubq has no `beforeEach`, `afterEach`, `beforeAll`, or `afterAll`.

`ubq convert` makes the setup function for a `beforeEach` and an
`afterEach` that assign no variable from outside: `const setup =
() => {...}`, with `cleanup(teardown)` for the `afterEach`. It
puts `setup()` at the start of each test of the file or of the
`describe`, and the setup of a `describe` calls the setup of the
group around it. It makes this change only where it knows each
test of the group. Each other hook gets a TODO: a hook that
assigns a variable (`client = makeClient()`), two hooks of one
kind in a group, a hook after a test, or a group that calls a
function that can make tests. Do those by hand:

- **Setup for each test.** Make a function that does the setup
  and returns what the test needs. Call it in each test.

  ```ts
  // before
  let db: Db
  beforeEach(async () => { db = await open(':memory:') })
  afterEach(() => db.close())
  it('adds', () => { db.add(1); expect(db.count()).toBe(1) })

  // after
  const setup = async () => {
    const db = await open(':memory:')
    cleanup(() => db.close())
    return db
  }
  test('adds', async () => {
    const db = await setup()
    db.add(1)
    assert.equal(db.count(), 1)
  })
  ```

- **Work after each test.** `cleanup(fn)` in the test or in its
  setup function. It runs when the test ends, also if the test
  fails.
- **Setup one time for the file.** Code at the top level of the
  file, before the first `test`. `cleanup`, `testdir`, `env`, and
  `spyOn` at the top level last until the file ends. Top-level
  `await` works.
  A `beforeAll` callback runs after the whole file loaded. Code at
  the top level runs at its place, so put it after the
  declarations that it uses. The command changes a `beforeAll` at
  the top level to a block (`{ ... }`) at the same place, if the
  callback uses no name that the file declares below it. A block
  keeps the local names of the callback out of the file. In a
  Workers test file, the block must come after `await
  migrate(...)`.
- **Setup one time for a group.** A `describe` function cannot
  `await`. Make a function that does the work one time, and await
  it at the start of each test of the group:

  ```ts
  let ready: Promise<void> | undefined
  const setup = () => (ready ??= prepare())
  test('first', async () => {
    await setup()
  })
  ```

  Tests that need the result of an earlier group in a shared
  database are fragile. A test that makes its own rows is better.
- **Setup one time for all files.** ubq has none. Each test file
  is its own process. Put the setup in a module, and import it in
  each test file that needs it.

## Failures after the conversion

Find the kind of the failure before you change a line.

| The report says | The cause | Do this |
| --- | --- | --- |
| the test ran no assertions | The old tool passed a test with no check. | Add the assertion that the test name promises. If the test only checks that a call does not throw, assert on its result. |
| expected values to be deeply equal (with a difference of type or prototype) | The old assertion was loose. | Make the expected value exact, or use `assert.match`. |
| assert.rejects was not awaited | The old tool waited for it. | Add `await`. |
| after the test ended: ... | The test starts work and does not wait for it. | `await` the work. This was a defect in the old test. |
| the test changed the environment variable ... | The test sets `process.env` and does not put it back. | `env({ NAME: 'value' })`. |
| the test did not end in 5000 ms, with `still open: ...` | The test leaves a server, a timer, or a process open. | Close it with `cleanup`. The `HANG` block names the line that opened it. |
| `duplicate test name` | Two tests of one group have one name. | Make the names different. |
| test name must be a string that is not empty | tap permits an empty name. | Give each test a name. A name from data can be empty, or two can be the same: use `JSON.stringify(value)`, and add ` #2` to a repeat. |
| the test process ended before the file loaded ubqtest | The file still imports the old tool, or it is not a test file, such as a snapshot file of tap. | Convert it, or put it in `"exclude"`. |
| the test file did not load | A syntax error, an import that names no file, or syntax that Node cannot run. | Read the line in the report. See "Imports of the source". |
| the file registered no tests | The file is a helper, not a test file. | Put it in `"exclude"`. |
| a `TYPE` block | The type checker runs with each run. | Correct the type. A mock must have the types of the real export. |
| a `TYPE` block at a converted assertion, such as "Argument of type 'string \| undefined' is not assignable to parameter of type 'string'" | `expect()` took a value of each type. `assert` is strict: the actual value cannot be `undefined` where a method is called on it, and the expected value must have the type of the actual value (the parameter is `NoInfer<T>`). | Add `!` or `?.` to the actual value, or narrow it first with `assert(value)`. If the two types differ on purpose, write `assert.deepEqual<unknown>(a, b)`. |

A test that fails in ubq for one of the first six causes was not
correct before: it passed for the wrong reason. Correct the test.
Do not skip it.

## When you are done

Run `ubq check`. It fails if a test failed in its last run, or if
code changed after its tests ran. `ubq review` compares only
tests of ubq, so it does not compare the tests of the old tool with
the converted tests. Use it for the changes after the conversion.

Report to the user:

- the count of tests before and after, and the reason for each
  difference
- each test that you changed in more than its form, and why
- each thing that ubq does not have and the project used
  (a DOM, a coverage limit, a global setup), with what you did
- each `TODO(ubq)` that is still in the code
