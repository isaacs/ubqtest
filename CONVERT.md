# ubq guide: convert

How to move the tests of a project from tap, `node:test`, vitest,
jest, or mocha to `ubqtest`. This text comes from the installed
package. `ubq guide convert` prints it. Read `ubq guide` first: it
has the API and the rules of ubq.

## The steps

1. **Record the old result.** Run the old test command. Write
   down the count of tests that pass, and each test that fails or
   is skipped. You compare with this at the end.
2. **Install.** `npm install --save-dev ubqtest`. Then `npx ubq
   doctor`, and do each `FIX` line.
3. **Convert.** `npx ubq convert test` (give the folders and files
   that have tests). `--dry` shows the report and changes no file.
   The command changes the files in place. Commit before it, so
   that `git diff` shows the changes.
4. **Do each TODO.** The command writes `// TODO(ubq): ...` above
   each statement that it cannot change. `grep -rn 'TODO(ubq)'
   test` lists them. The sections below tell how to do each kind.
   Remove the comment when its statement is done.
5. **Run.** `npx ubq`. Do one failure at a time: `npx ubq
   <file>:<line>` runs one test. Read "Failures after the
   conversion" below before you change a test.
6. **Compare.** The count of tests that pass must be the count of
   step 1, or you must know the reason for each difference. A
   test that passed before and is skipped or removed now is a
   defect of the conversion.
7. **Clean up.** Set `"test": "ubq"` in the `scripts` of
   `package.json`. Remove the old test tool, its plugins, and its
   configuration (`.taprc`, `vitest.config.*`, `jest.config.*`,
   `.mocharc.*`, `c8` and `nyc` settings). Change the test command
   of CI. The folder `.ubq/` has the run store, and git ignores it
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

It does not change the name of a file, the source of the project,
or `package.json`.

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

- A test can import `'../src/parse.js'` when the file is
  `parse.ts`. ubq finds the `.ts` file.
- A test that imports the build output (`'../dist/index.js'`)
  works only after a build. Import the source (`'../src/index.ts'`):
  then a run needs no build, and coverage has the source lines.
- Node runs TypeScript with the types removed, and no other
  change. Source with `enum`, `namespace`, or a parameter property
  (`constructor(private x: number)`) does not load. `ubq doctor`
  checks `erasableSyntaxOnly`. If the project has such syntax, tell
  the user: the choice is to change that syntax or to run the
  tests on Bun (`bun node_modules/.bin/ubq`).

## tap

| tap | ubq |
| --- | --- |
| `t.test(name, async t => { ... })` | `test(name, async () => { ... })` |
| `t.equal(a, b)`, `t.is`, `t.strictEqual` | `assert.equal(a, b)` |
| `t.not(a, b)`, `t.notEqual` | `assert.notEqual(a, b)` |
| `t.same(a, b)`, `t.strictSame`, `t.deepEqual` | `assert.deepEqual(a, b)` |
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
  pass with the old tool, run `npx ubq --update <file>` for each
  file with `assert.snapshot`, read the new files, and remove
  `tap-snapshots/`.
- **`t.skip`, `{ skip: true }`, `{ todo: true }`.** Give the
  reason as text: `test(name, { skip: 'needs a GPU' }, fn)`.
- **Coverage settings.** tap fails a run with less than full
  coverage. ubq has no such limit. `npx ubq uncovered` lists the
  code that no test ran.
- **A fixture or helper that uses `t`.** A helper function that
  gets `t` as an argument must import `assert` from `ubqtest` and
  must not get `t`.

## node:test and node:assert

| node | ubq |
| --- | --- |
| `it`, `test` from `node:test` | `test` |
| `assert.strictEqual`, `assert.equal` | `assert.equal` |
| `assert.deepStrictEqual`, `assert.deepEqual` | `assert.deepEqual` |
| `assert.notStrictEqual` | `assert.notEqual` |
| `assert.ok(a)` | `assert(a)` |
| `assert.throws(fn)`, `assert.rejects(p)` | the same with `Error` as the expected error |
| `assert.ifError(err)` | `assert(!err)` |
| `mock.fn(impl)`, `mock.method(object, key)` | `spy(impl)`, `spyOn(object, key)` |

Things to check by hand:

- **`assert.equal` and `assert.deepEqual` from `node:assert`
  (not strict) are loose.** In ubq they are strict.
- **`assert.doesNotThrow(fn)`.** Call the function, and assert on
  its result.
- **`assert.notDeepStrictEqual`, `assert.doesNotMatch`.** Write
  the condition: `assert(!pattern.test(text))`.
- **The test object `t`.** `t.mock.fn()` is `spy()`. `t.after(fn)`
  is `cleanup(fn)`. `t.test(...)` is a subtest: use `describe`.
  `t.diagnostic(text)` is `console.log(text)`. `t.skip()` in a
  test: use `{ skip: condition && 'the reason' }`.
- **`before`, `after`, `beforeEach`, `afterEach`.** See "Hooks".
- **`mock.timers`.** Use `fakeClock`.

## vitest and jest

| vitest, jest | ubq |
| --- | --- |
| `it`, `test` | `test` |
| `expect(a).toBe(b)` | `assert.equal(a, b)` |
| `expect(a).toEqual(b)`, `toStrictEqual` | `assert.deepEqual(a, b)` |
| `expect(a).not.toBe(b)` | `assert.notEqual(a, b)` |
| `toBeTruthy()`, `toBeFalsy()` | `assert(a)`, `assert(!a)` |
| `toBeNull()`, `toBeUndefined()`, `toBeDefined()` | `assert.equal(a, null)`, `assert.equal(a, undefined)`, `assert.notEqual(a, undefined)` |
| `toContain(b)`, `toHaveLength(n)` | `assert(a.includes(b))`, `assert.equal(a.length, n)` |
| `toMatch(/re/)`, `toMatch('text')` | `assert.match(a, /re/)`, `assert(a.includes('text'))` |
| `toMatchObject(o)` | `assert.match(a, o)` |
| `toBeInstanceOf(C)` | `assert(a instanceof C)` |
| `toBeGreaterThan(b)` and the other comparisons | `assert(a > b)` |
| `expect(fn).toThrow(x)` | `assert.throws(fn, x)` (a text becomes a RegExp) |
| `await expect(p).rejects.toThrow(x)` | `await assert.rejects(p, x)` |
| `await expect(p).resolves.toEqual(b)` | `assert.deepEqual(await p, b)` |
| `toHaveBeenCalled()`, `toHaveBeenCalledTimes(n)` | `assert(s.calls.length > 0)`, `assert.equal(s.calls.length, n)` |
| `toHaveBeenCalledWith(...args)` | `assert.deepEqual(s.calls.at(-1)?.args, [...args])` |
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
  arguments. The converted line checks the last call. If the call
  is not the last one, use
  `assert(s.calls.some(c => ...))` or the index of the call.
- **`expect.any`, `expect.objectContaining`, `expect.anything`.**
  `assert.match` with a partial object does the work of
  `objectContaining`. For `any(String)`, assert on `typeof`.
- **`toBeCloseTo(b)`.** `assert(Math.abs(a - b) < 0.005)`.
- **`it.each(table)`.** A `for` loop around `test()`. Each test
  name must be different: put the value in the name.
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
- **`mockReturnValue`, `mockResolvedValue`, `mockImplementation`.**
  A spy gets its implementation when it is made: `spy(() => 1)`,
  `spy(async () => value)`. For a different result in each call,
  write the logic in the implementation.
- **`fn.mock.calls[0]`** is `fn.calls[0]?.args`.
  `fn.mock.results[0].value` is `fn.calls[0]?.result`.
- **`vi.useFakeTimers()`, `vi.advanceTimersByTime(ms)`.**
  `const clock = fakeClock({ now: 0 })`, then `await
  clock.tick(ms)`. The clock goes back when the test ends.
- **`beforeEach` and the other hooks.** See "Hooks".
- **Globals.** jest gives `describe`, `it`, and `expect` with no
  import. ubq has no globals. The command adds the import.
- **A DOM (jsdom, happy-dom), a custom environment, a
  transform.** ubq has none. Tell the user about each test file
  that needs one.

## mocha

The command converts `describe` and `it` with `node:assert`. It
does not convert `chai` or `sinon`. Write those assertions by hand
with the tables above. `this.timeout(ms)` becomes
`test(name, { timeout: ms }, fn)`.

## Hooks

ubq has no `beforeEach`, `afterEach`, `beforeAll`, or `afterAll`.

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
- **Setup one time for all files.** ubq has none. Each test file
  is its own process. Put the setup in a module, and import it in
  each test file that needs it.

## Failures after the conversion

Find the kind of the failure before you change a line.

| The report says | The cause | Do this |
| --- | --- | --- |
| `the test ran no assertions` | The old tool passed a test with no check. | Add the assertion that the test name promises. If the test only checks that a call does not throw, assert on its result. |
| `expected values to be deeply equal`, with a difference of type or prototype | The old assertion was loose. | Make the expected value exact, or use `assert.match`. |
| `assert.rejects was not awaited` | The old tool waited for it. | Add `await`. |
| `after the test ended: ...` | The test starts work and does not wait for it. | `await` the work. This was a defect in the old test. |
| `the test changed the environment variable ...` | The test sets `process.env` and does not put it back. | `env({ NAME: 'value' })`. |
| `the test did not end in 5000 ms`, with `still open: ...` | The test leaves a server, a timer, or a process open. | Close it with `cleanup`. The `HANG` block names the line that opened it. |
| `duplicate test name` | Two tests of one group have one name. | Make the names different. |
| `the test file did not load` | A syntax error, an import that names no file, or syntax that Node cannot run. | Read the line in the report. See "Imports of the source". |
| `the file registered no tests` | The file is a helper, not a test file. | Put it in `"exclude"`. |
| a `TYPE` block | The type checker runs with each run. | Correct the type. A mock must have the types of the real export. |

A test that fails in ubq for one of the first six causes was not
correct before: it passed for the wrong reason. Correct the test.
Do not skip it.

## When you are done

Report to the user:

- the count of tests before and after, and the reason for each
  difference
- each test that you changed in more than its form, and why
- each thing that ubq does not have and the project used
  (a DOM, a coverage limit, a global setup), with what you did
- each `TODO(ubq)` that is still in the code
