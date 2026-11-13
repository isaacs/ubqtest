# ubq feedback: conversion of a Cloudflare Workers project

Date: 2026-11-13. ubqtest 0.0.3. Node 26.5.0, macOS.

(Report from another Claude agent instance)

## Summary

I tried to convert this project from vitest to ubq. I stopped before the tests ran, and went back to vitest. ubq has no way to run tests in the Workers runtime (workerd), and this project's tests depend on it. A workaround on Node is possible, but it changes what the tests prove.

The items below are in order of weight. Each one says if I tested it or only read it.

## The project

- Two Cloudflare Workers: the Boss (`src/`) and the Analyst (`analyst/src/`).
- 22 test files, 225 tests, about 6,400 lines. All pass with vitest 5 and `@cloudflare/vitest-plugin`. The run takes about 3 seconds.
- The plugin runs each test file inside workerd. It gives the tests real local bindings: D1 (`env.DB`) and R2 (`env.RUNS`), plus plain text vars.
- 18 of the 22 test files import from `cloudflare:test`. They use `env`, `createExecutionContext`, `waitOnExecutionContext`, `createScheduledController`, and `applyD1Migrations`.
- 5 source files import from `cloudflare:workers` (`WorkflowEntrypoint`, `WorkerEntrypoint`, `DurableObject`).
- A vitest setup file applies 14 D1 migrations before each test file.

## 1. No Workers runtime (blocker)

Tested. A converted file does not load:

```
ERROR analyst/test/sandbox.test.ts
  the test file did not load: Only URLs with a scheme in: file, data, and node are supported by the default ESM loader. Received protocol 'cloudflare:'
```

There are two separate causes:

- The test file imports `cloudflare:test`. That module exists only in the vitest plugin.
- The source imports `cloudflare:workers`. Node cannot resolve it. So a test file that imports only the source fails too.

The guide, the convert guide, and the files in the package do not mention Cloudflare, workerd, or miniflare. `ubq doctor` reported "ok 22 test files" and gave no warning about the `cloudflare:` imports. `ubq convert` left the `cloudflare:test` imports in place with no TODO comment.

Suggestions:

- Say in the guide that Workers are not supported, if that is the plan.
- Make `ubq doctor` and `ubq convert` report imports with a scheme that the runtime cannot load (`cloudflare:`), and report a vitest config that uses `@cloudflare/vitest-plugin`. That tells the user about the problem before they convert 21 files.
- Longer term: a workerd runtime next to Node, Bun, and Deno.

## 2. No preload or setup module in the config

Tested with a probe. This is what made the Node workaround awkward.

The workaround needs a Node resolve hook, which maps `cloudflare:workers` to a stub file:

```js
import { registerHooks } from 'node:module'
const stub = new URL('./cf-workers.ts', import.meta.url).href
registerHooks({
  resolve: (spec, ctx, next) =>
    spec === 'cloudflare:workers'
      ? { url: stub, shortCircuit: true }
      : next(spec, ctx),
})
```

The hook must be registered before Node links the test file. A static import in the test file is too late, because Node resolves all static imports of a file before it runs any of them. So the hook must come from outside the test file.

The `ubq` config key has no entry for this (`include`, `exclude`, `timeout`, `hangRerun`, `bunInspectorCoverage`, `browser`). The only way I found was the environment:

```
NODE_OPTIONS='--import ./test/probe/register.ts' npx ubq test/probe/probe.test.ts
```

That worked: ubq passes `NODE_OPTIONS` to the process of the test file. But it has costs:

- The rerun command that ubq prints (`rerun: ubq test/a.test.ts:6`) fails without the variable.
- `node test/a.test.ts` fails too, so "a test file is a plain program" is no longer true.
- The hook file imports `node:module`. This project has no `@types/node`, because Worker code must not see Node types. The type checker of ubq then reports errors in the hook file. I would have to write it as `.js` to hide it from the type checker.

Suggestion: a config key for modules to load before each test file, for example `"ubq": { "preload": ["./test/register.js"] }`. The rerun command and the plain `node` form would stay a problem for the second, so the docs could say that.

## 3. The Node workaround, and why I did not use it

A probe test passed under ubq on Node. It did these things:

- Loaded `src/index.ts` (the Hono app, which imports `cloudflare:workers` through other files) with the hook from item 2.
- Got bindings from wrangler: `getPlatformProxy<Env>({ configPath: './wrangler.jsonc', persist: false })`.
- Ran `SELECT 1` on the D1 binding and compared the result.

I did not test more than that. The full plan would need these parts, all in test code:

- A stub for `cloudflare:workers` with three base classes.
- A module that replaces `cloudflare:test`: `env` from the proxy with the test values on top, fake versions of `createExecutionContext`, `waitOnExecutionContext`, and `createScheduledController`, and code to apply the D1 migrations. The migrations have triggers, and D1 `exec()` takes one statement for each line, so this needs care.
- `cleanup(() => proxy.dispose())` at the top level, so workerd stops when the file ends.

Reasons I stopped:

- The Worker code would run on Node, not workerd. The tests would no longer catch differences between the two in `crypto`, `fetch`, streams, and `Request`. For a Worker, that is a large part of the value of the tests.
- Each D1 and R2 call becomes a round trip to a separate workerd process. One test file inserts 120 rows in its setup. I did not measure the time.
- Most tests replace `globalThis.fetch`. I did not check that this leaves the traffic of the proxy alone.
- 22 workerd processes start in parallel, one for each test file. I did not measure that.

## 4. The converter: results

Tested. `npx ubq convert test` and `npx ubq convert analyst/test` changed 21 files, about 1,150 lines in and 1,200 out. The plain assertions converted cleanly, and that was most of the work: `toBe` (167), `toContain` (154), `toEqual` (82), `not.toContain` (33), `toMatchObject` (32), `toHaveLength` (25), `toMatch` (14).

It left 39 TODO comments:

| Count | Kind |
| --- | --- |
| 20 | no hooks (`beforeAll`, `afterEach`) |
| 6 | spy implementation (`mockImplementation`, `mockResolvedValue`, `mockRestore`, `mock.calls`) |
| 5 | "Use mockImport" on `vi.restoreAllMocks()` |
| 5 | `toContainEqual`, `not.toContainEqual` |
| 2 | `toBeCloseTo` |
| 1 | `not.toHaveProperty` |

After the conversion, a run reports 66 type errors. Most are names that the converter left with no import: `afterEach`, `beforeAll`, `vi`, `expect`.

### 4a. Wrong hint on `vi.restoreAllMocks()`

```ts
// TODO(ubq): ubq has no hooks. Make a setup function and call it in each test. Use cleanup() for the work after a test.
// TODO(ubq): Use mockImport: await mockImport(() => import('../src/a.ts'), [[() => import('../src/dep.ts'), { fn }]]). It gives a new instance of a.ts.
afterEach(() => vi.restoreAllMocks())
```

`vi.restoreAllMocks()` puts back spies. It has no relation to module mocks. The correct hint: "A `spyOn` spy goes back when the test ends. Delete this line." The same applies to `afterEach(() => restore())` where `restore` comes from `spy.mockRestore`.

The converter could delete `afterEach(() => vi.restoreAllMocks())` with no TODO, because ubq already does what the line does.

### 4b. Spy chains could convert

These forms are regular, and the converter could rewrite them:

```ts
vi.spyOn(globalThis, 'fetch').mockImplementation(impl)   // spyOn(globalThis, 'fetch', impl)
vi.spyOn(globalThis, 'fetch').mockResolvedValue(value)   // spyOn(globalThis, 'fetch', async () => value)
spy.mock.calls[0]![0]                                    // spy.calls[0]!.args[0]
```

Today it converts `vi.spyOn` to `spyOn`, leaves the chain, and adds a TODO.

### 4c. `beforeAll` at the top level of a file

15 of the 20 hook TODOs are easy, but only one hint covers them all. The hint says "Make a setup function and call it in each test." For a `beforeAll` at the top level of a file, the guide gives a better answer: top-level code, with top-level `await`. The hint could say that.

One risk: a `beforeAll` callback can use a `const` that the file declares below it, because the callback runs later. Top-level code at the same place fails at run time. The converter could move the code to the end of the declarations, or the hint could warn about it.

### 4d. `beforeAll` in a `describe`

Two files have this form:

```ts
describe('release pages', () => {
  beforeAll(async () => {
    await env.DB.prepare("UPDATE advisories SET github_state = 'draft' WHERE ghsa_id = ?").bind(ghsa).run()
  })
  // tests
})
```

The hook must run after the tests of the earlier groups, which change the same row, and before the first test of this group. ubq has no direct form for it:

- The `describe` function is sync, so it cannot `await`.
- Top-level code runs before all tests, which is too early.

The only answer I found is a function that keeps its promise, called at the start of each test of the group:

```ts
let ready: Promise<void> | undefined
const setup = () => (ready ??= (async () => { /* ... */ })())
```

That works, but each test of the group gets an added line, and a new test that omits the line fails only when it runs alone or first. A note in the guide for this case would help. Tests that share a database across groups are a poor design, but they are common in projects that convert.

### 4e. Matchers with no equivalent

- `toContainEqual(obj)`: the hint lists `assert`, `assert.equal`, `assert.deepEqual`, `assert.match`. None of them tests "some element of the array deep-equals this". I would have to write my own compare function, because nothing in ubq gives deep equality as a boolean. A form of `assert.match` for "the array has an element that matches", or an exported `isDeepEqual`, would fix it.
- `toBeCloseTo(n)`: `assert(Math.abs(a - n) < 0.005)` is fine. The hint could give that line.
- `not.toHaveProperty('k')`: `assert(!('k' in obj))` is fine. The hint could give that line.

### 4f. Files with a helper name

`test/helpers.ts` uses `vi.spyOn`, and the converter did convert it. Then it printed:

```
note: 1 of these files do not have a name that ubq runs (*.test.ts). Rename them, or add to package.json: "ubq": { "include": ["test/**/*.ts"] }.
```

For a helper file that advice is wrong: it has no tests, and with that `include` it would fail as a file with no tests. The note could say "if this file has tests".

## 5. Spies: things that work, and one gap

Tested with a probe.

- Two `spyOn` calls on the same key in one test work. The second one wins, and the original comes back for the next test. Two tests here change the `fetch` mock in the middle of a test, and this covers them.
- A spy has no `restore()`. So a test cannot go back to the real method before it ends. No test here needs that, but `mockRestore` is common in vitest and jest code, and the converter has no target for it.

The guide does not say what a second `spyOn` on the same key does. A sentence would save a probe.

## 6. The type check on a run of one file

Tested. `npx ubq analyst/test/sandbox.test.ts` printed type errors for other files (`test/actions.test.ts`, `test/batches.test.ts`, and more), and counted all 66 in the summary line. In a conversion, where I fix one file at a time, the result of the selected file gets lost among errors of files I have not reached.

Suggestion: for a run of a selection, print only the type errors of the selected files and the files they import, or print the others as one count.

Also: ubq used the root `tsconfig.json`. This project has a second one, `analyst/tsconfig.json`, for the second Worker. I did not check if ubq uses it for the files under `analyst/`.

## 7. `ubq doctor` and tsconfig

Tested. doctor printed one FIX:

```
FIX  tsconfig.json: set "allowImportingTsExtensions": true and "erasableSyntaxOnly": true in compilerOptions.
```

Both are reasonable. Two notes:

- The message says "Test files import source files with the .ts extension". Here they import with `.js`, which the guide says also works under ubq. So `allowImportingTsExtensions` is not needed for this project, and the reason in the message is not true for it.
- The source has no `enum`, `namespace`, or parameter property, so `erasableSyntaxOnly` would cost nothing here.

## 8. Things that worked well

- `npm install --save-dev ubqtest` and `npx ubq doctor` worked the first time.
- The `GUIDE.md` and `CONVERT.md` files in the package made it possible to work from the installed version, with no need for the web site.
- The converter did the bulk of the work without errors. I read the diff of two files in full, and found no wrong conversion.
- The failure output is clear, and the load error in item 1 names the cause.
- `.ubq/` has its own `.gitignore`, so it added nothing to `git status`.

## What would make ubq usable for this project

In order:

1. A workerd runtime, with bindings from a wrangler config. This is the only complete answer.
2. Without that: a `preload` config key (item 2), plus a documented recipe for Workers on Node with `getPlatformProxy`. This works only for projects that accept tests on Node.
3. Converter fixes 4a, 4b, and 4c. They would remove about 26 of the 39 TODO comments in this project.
