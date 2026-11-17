# Agent feedback: vitest to ubqtest 0.0.15, two Cloudflare Workers

Project: two Workers (a Hono app with D1, R2, Workflows, and a service binding; and a second Worker with a Workflow, a Durable Object, and a container). Before: vitest 5 with `@cloudflare/vitest-plugin`, two vitest projects, a `setupFiles` that applied D1 migrations, and a copy of a wrangler config with no `containers`. 22 test files, 225 tests, about 6,300 lines.

Agent: Claude Code (Claude Opus 5.5). It read `ubq guide convert` and `ubq guide` from the installed package, and the pages at ubq.dev.

## Result

- 225 tests pass under ubq, the same count as vitest. No test was skipped or removed.
- No change to source code.
- `ubq convert` changed 23 files and left 17 `TODO(ubq)` comments. All 17 were easy to do.
- After the TODOs, 15 type errors were left. All came from the strict `assert` types.
- The run time fell from 4.8 s (vitest) to 2.3 to 2.7 s.
- The copy of the wrangler config (`wrangler.test.jsonc`, made only to leave out `containers`) is gone. ubq loads the real config. The `convert` note that said so was correct and useful.
- `migrate('DB')` replaced the setup file and the `readD1Migrations` binding with no work by hand.

Most of the work was in the TODOs of hint [1], and in the type errors.

## Things that did not go smoothly

### 1. The converter left the `restore` pattern that its own guide describes (10 of 17 TODOs)

The guide (vitest section, `vi.restoreAllMocks()`) says:

> If a helper of the project gives a restore function (`restore = m.restore`, with `afterEach(() => restore())`), delete the hook and each assignment.

And: "The command removes a hook that only restores, and each call."

This project had that exact form in 10 files:

```ts
let restore = () => {}
afterEach(() => restore())
// ...in tests:
const m = mockFetch({...})
restore = m.restore
```

The converter did not change it. It wrote a TODO [1] in each of the 10 files. The fix was the same in each file: delete three kinds of line. I did it with one regular expression. The converter can detect this form, because it wrote a hint that names it.

Also, the converter removed `afterEach` from the import but left the `afterEach(...)` call. So 10 files did not load at all ("afterEach is not defined"). The first run showed 11 load errors and 102 passed, which looked worse than it was. A suggestion: if a hook stays as a TODO, keep the file loadable. For example, comment the hook out under the TODO, instead of leaving a call to a name that is not imported.

### 2. Hint [3] and hint [1] are two halves of one change

In the helper module, the converter changed `vi.spyOn(globalThis, 'fetch').mockImplementation(fn)` to `spyOn(globalThis, 'fetch', fn)`. That was correct. It left `return { calls, restore: () => spy.mockRestore() }` with TODO [3]. `mockRestore` does not exist on a ubq spy, so this was also a type error.

The fix for [3] (remove `restore` from the helper) and the fix for [1] (remove each use of `restore` in 10 test files) are one change. The hints do not say that they are related. Hint [1] says "Then remove that function from the helper that gives it", but the TODO in the helper does not point back to the callers.

### 3. Formatting of multi-line assertions

The converter joins the first argument and the second argument onto one line, and keeps the rest of the original lines with their old indent:

```ts
// before
expect(describeModelError(er, 60_400)).toBe(
  'The model API call failed after 60 seconds with 522: ' +
    `${er.message}. Request ID: req_1. The endpoint did not answer. ` +
    'the Messages API.',
)
// after ubq convert
assert.equal(describeModelError(er, 60_400), 'The model API call failed after 60 seconds with 522: ' +
    `${er.message}. Request ID: req_1. The endpoint did not answer. ` +
    'the Messages API.')
```

This project has no formatter (prettier or other), so the result stays in the code. Lines longer than 100 characters in the test files went from 28 to 44. A suggestion: when the old expected value started on its own line, put each argument of the assertion on its own line:

```ts
assert.equal(
  describeModelError(er, 60_400),
  'The model API call failed after 60 seconds with 522: ' +
  ...
)
```

### 4. `expect.arrayContaining` of strings, and `expect.any(Number)`

- `expect(names).toEqual(expect.arrayContaining(['a', 'b']))` became `assert.deepEqual(names, expect.arrayContaining([...]))` with TODO [5]. The values were string literals. The hint itself says what to write (`assert.contains(list, x)` for each). The converter could write that for a literal array of primitives.
- `expect(body).toEqual({ count: expect.any(Number) })` became a TODO. There is no ubq form for "any number" inside a pattern, so the strict check takes three lines: cast the body, `assert.deepEqual(Object.keys(body), ['count'])`, then `assert.equal(typeof body.count, 'number')`. A question: can `assert.match` take a type as a value in the pattern (for example `{ count: Number }`), or is that out of scope on purpose?

### 5. TODO comments are long and the same text repeats

Each `TODO(ubq)` comment is one line of 250 to 350 characters with the full hint. The same hint text was in 10 files. The report at the end of `convert` already numbers the hints. A shorter comment that names the hint and the section of the guide (for example `// TODO(ubq): hooks. See "ubq guide convert", Hooks.`) would be easier to read in a diff. This is a preference.

### 6. The converter dropped `serviceBindings` with no note

The vitest config had:

```ts
miniflare: {
  bindings: { ... },
  serviceBindings: {
    ANALYST: () => new Response('no Analyst in tests', { status: 500 }),
  },
}
```

`convert` wrote the plain values of `bindings` to `vars`, which is correct. It printed no note about `serviceBindings`. The guide says "Read the notes that it prints: a value that is not plain must go into `vars` by hand", so I expected a note for each value that it did not carry over. Under ubq, the binding gives the 503 stand-in, not 500. No test here checked that status, so nothing failed. But a project whose tests do check it would get a failure with no note to explain it.

### 7. `test/env.d.ts` was left behind

The project had `test/env.d.ts`, which added `TEST_MIGRATIONS: D1Migration[]` to `Cloudflare.Env`, with `import type { D1Migration } from '@cloudflare/vitest-plugin'`. The converter said that `test/setup.ts` can go. It said nothing about this file. After the old tool is removed (step 7), this file is a type error. A note like the one for the setup file would help: "`TEST_MIGRATIONS` is not needed; remove its type declaration".

### 8. A clean `git status` before `convert`, after `doctor` changed files

Step 2 (`doctor`, then each FIX) changes `tsconfig.json`. Step 3 says `git status` must be clean before `convert`. So I had to commit (or stash) the step 2 change before step 3. I made a temporary commit and undid it later. A small thing, but the steps in the guide do not say to commit between them.

### 9. Type errors after the conversion

15 type errors, from `NoInfer<T>` on the expected value. Kinds:

- `T | undefined` from `noUncheckedIndexedAccess` (`runs[0]` in an expected array): 4. Fixed with `!`.
- `unknown` from a D1 row typed as `Record<string, unknown>`: 5. Fixed with `as string`.
- `string | null` against `string | undefined`: 2. Fixed with `!`.
- An object literal with `verdict: 'vulnerable'` (type `string`) against a union of literals: 4 (3 in one file, 1 in another). Fixed with `assert.deepEqual<unknown>(...)`, as the guide says.

The guide's table covers all of these. Two notes:

- The message for the last kind was hard to read. The code was `assert.deepEqual(validateSubmission(submission), submission)`. TypeScript said "Argument of type '{ verdict: string; ... }' is not assignable to parameter of type 'string | SubmittedResult'". `validateSubmission` takes `Record<string, unknown>`, so my first thought was that the call to `validateSubmission` was wrong. The parameter in the message is the `expected` parameter of `assert.deepEqual`. A ubq hint under a TYPE block at an `assert` call (for example "the expected value must have the type of the actual value; to compare on purpose, use `assert.deepEqual<unknown>`") would save time.
- The summary said "and 10 more type errors. For all of them: npx tsc --noEmit". In this project that command does not show the type errors of `analyst/`, which has its own `tsconfig.json`. `ubq failures` did show all of them. A suggestion: name `ubq failures` there, or give one `tsc -p` command for each project that ubq checked.

### 10. `ubq server` did not make the Workers tests faster

All test files here are Workers tests. I measured one file of 6 tests:

- with no server: `ubq --changed` (one file) took 0.87 s.
- with `ubq server` running: `ubq test/github.test.ts` took 1.0 s.

The server printed "8 test processes wait". The guide says "a run of a few files is about 30 ms". I suppose the processes that wait are Node processes, and a Workers test file needs a new workerd process each time. If so, the guide could say that the server does not help Workers tests, or by how much. This is from one measurement each, so treat it as a question.

### 11. `ubq check` output for a configuration change

After the conversion, `ubq check` printed:

```
Changes to the tests to look at:
configuration: the "ubq" key of package.json changed
  - (none)
  + {"workers":[{"config":"wrangler.jsonc","include":[...],"vars":{...}}, ...]}
pass: 225 tests pass on the code as it is now, and each change ran in a test.
```

The `+` line is one line of about 450 characters of JSON. It was hard to read. Also, `- (none)` and then `+ {...}` read like a diff, but the heading does not say so.

### 12. `doctor` grammar

`doctor: 1 problems` should be `1 problem`.

### 13. `migrate('DB')` in every file of the project

The converter put `await migrate('DB')` in each test file of the first Worker, also in files that never use the database (for example, the tests of a pure function that reads release notes). That matches the old `setupFiles`, which also ran for each file, so it is correct. It adds a line of noise to files that do not need it. A question, not a request: is it possible to add it only where the file (or a helper it imports) uses `env.DB`? Probably that is not safe to detect, so the current behavior is a fair choice.

## Things on the website (ubq.dev)

From the pages at ubq.dev (not from the installed guide):

- On the Workers section and the API and convert pages, the word "D1" (the Cloudflare database) links to `docs/decisions/#d1-coverage-is-always-on-...`. That anchor is design decision D1, about coverage. It is not about Cloudflare D1.
- The landing page lists five tools that `convert` reads (tap, node:test, vitest, jest, mocha). The convert page also lists `bun:test`.
- The API page gives `test` and `describe` only as `const test: Test` and `const describe: Describe`, and the types `Test`, `Describe`, `ErrorMatch`, `Loader`, and others are not defined on that page.
- The config page says of `workers`: "A file must also be a test file by include and exclude of the first rows". It is not clear which rows. It also does not say if `config` and `include` are required in a `workers` entry.
- Workflows (a binding type that this project uses) are not named on any page. They worked with no change.

## Things that went well

- `ubq doctor` found the one problem, and its FIX line said exactly what to set.
- The `doctor` note about Workers ("Do not add it by hand: `ubq convert` writes it") stopped me from writing the `workers` key by hand.
- The converter got the `workers` key right on the first try, for two Workers, with all test values.
- A wrangler config with `containers`, a Workflow, a Durable Object, and a service binding loaded with no change.
- `env` from `cloudflare:workers`, and the mapping of `createExecutionContext` and `createScheduledController`, worked with no change.
- The hints in the `convert` report were correct in each case. Each one told me what to do.
- `ubq <file>:<line>` ran one test and printed "23 not selected", which is clear.
- The failure blocks give a `rerun:` command and a seed. Useful.
- The run is about twice as fast as vitest for this project.
- `.ubq/` is ignored by git with no setup (it has its own `.gitignore`).
