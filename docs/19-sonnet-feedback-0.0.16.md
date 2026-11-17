# ubqtest 0.0.16 feedback: sentry-javascript `packages/core`

Model: Claude Sonnet 5.5. Date: 2026-11-17. Repo: getsentry/sentry-javascript (pnpm monorepo, Node 26.5.0, Bun available).

## Prompt

> Please convert the tests in this repo to ubqtest from <htts://ubq.dev>
> This is an experiment, so please do not commit, push, or open
> any PRs. Follow the instructions as you find them, and document
> what went smoothly, what did not go smoothly or was confusing,
> what you find beneficial/improved over our existing tests, and
> what you do not prefer. Write your findings to
> `19-sonnet-feedback-0.0.16.md`. The ubqtest library is in
> active development, so we will be sharing our findings with
> that project so that they can improve based on your feedback.

## Scope

The repo has about 1,950 test files. I converted only `packages/core` (167 test files, 3,633 tests, vitest 4.1). I chose this scope myself as a pilot.

I did not convert the other packages. About 780 files are in `dev-packages/e2e-tests` and 197 in `bundler-plugin-integration-tests`. They run their own Playwright or runner harness, and ubq does not replace that. Other `packages/*` unit tests use vitest with DOM or environment setups. I did not check how ubq handles them.

Nothing was committed, pushed, or opened as a PR.

## Process

1. Read https://ubq.dev. The `WebFetch` tool summarizes pages with a small model, so I got the convert guide from `npx ubq guide convert` and `npx ubq guide` instead. Both match the web text.
2. Recorded the baseline with vitest: 3,631 passed, 1 skipped, 1 failed (`test/types/typedef.test.ts` needs a build, so it fails before any change). I also saved a per-file result as JSON for comparison.
3. `pnpm add -D ubqtest@0.0.16`. `npx ubq doctor` printed one FIX line.
4. `npx ubq convert test`: 165 files changed, 1,787 `TODO(ubq)` comments, 4 files not converted (2 parse failures, see below; 2 helper files had no known tool).
5. Eight agents resolved the TODOs in parallel, each on its own file group. Another agent fixed 31 type errors. I then removed the vitest config from core.

## Result

| | Vitest baseline | ubq (Bun) |
| --- | --- | --- |
| Passed | 3,631 | 3,630 |
| Skipped | 1 | 1 |
| Failed | 1 (`typedef`, needs build) | 2 (`typedef`, same reason; `functiontostring`, see below) |
| Type errors | not checked | 2 (both in `src`, see below) |

Every file matched its baseline count in the group runs. Each agent used a loader workaround on Node or a `--define` option on Bun. The full run on Bun differs in one test: `FunctionToString > falls back to native toString when the original function lookup throws`. It passes on Node and fails on Bun. Bun prints `function ProxyObject() { [native code] }` for a `Proxy` of a function, and Node prints `function () { [native code] }`. The test is correct, and the runtime differs.

No `TODO(ubq)` comment and no vitest API remains in code. Two files still contain the word `expect(` inside comments.

The test command is now `BUN_OPTIONS="--define __DEBUG_BUILD__=true" bun node_modules/ubqtest/cli.js`. See "Loading project source" below for why I needed Bun.

Real defects the zero-assertion, timing, and leak rules found in the old tests are listed under "What went smoothly".

## Setup and tooling notes (not in the merged sections)

- `pnpm add -D ubqtest` ran without trouble. pnpm printed `Agent skills awaiting approval: ... ubqtest.` and it added `ubqtest@0.0.16` to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` on its own. I did not expect either, and I left the `pnpm-workspace.yaml` change in place.
- `npx ubq` prints a long `EBADDEVENGINES` warning in this repo, because the repo pins a different Node version in `devEngines`. This hides the first lines of every ubq command. Running `ubq` through a package script avoids it.
- `ubq doctor` wants `allowImportingTsExtensions` and `erasableSyntaxOnly` in `tsconfig.json`. In this repo `tsconfig.json` only covers `src/` and feeds the build. Tests use `tsconfig.test.json`. I put both options in `tsconfig.test.json`. Doctor still prints the FIX line, and ubq's type check works. Doctor does not follow `extends` or a test tsconfig. `erasableSyntaxOnly` in the build tsconfig would flag `src` files, so I did not set it there.
- Step 2 of the guide says to commit so that `git status` is clean before `ubq convert`. This experiment forbids commits, so I ran convert on a dirty tree (only `package.json`, `tsconfig.test.json`, and the lockfile). That is fine, but the guide has no advice for that case.
- `ubq convert` had two parse failures with no useful message: `test/lib/fetch.test.ts: Unexpected token (543:32)` and `test/lib/integrations/http/get-outgoing-span-data.test.ts: Unexpected token (89:32)`. Both lines are a nested `function name(): void {` declaration that follows a statement. `sdk.test.ts` also needed a manual conversion. The converter reports these with a line number but not the cause.
- The first full run after conversion printed 166 errors, 2,833 type errors, and a 20-block cap. `ubq failures 1` was needed to see the rest, which worked well.
- 72 test files imported `src` without a file extension (`'../src/utils/time'`). The converter did not add the extension, and `mockImport` and plain imports failed under Bun with `Cannot find module`. I fixed this with a script. Details are in the merged section below.
- The type errors in `src/utils/lru.ts` and `src/utils/error.ts` (TS1294, parameter properties) fail every run, and they appear in the output of every test file that imports them. The run exit code stays 1. I did not edit `src`, and the converted tests run on Bun because of this. A repo that cannot change `src` needs a per-path option to exclude files from the type check.

## Type errors found by ubq's checker in the converted tests

These come from the converter's output, not from the old tests. Source: the agent that fixed them (31 errors in 4 files).

- `spy(event => ...)` and `spy(log => ...)` with an untyped parameter infer `unknown`. This broke property access, spread, and every place that passes the spy as an option such as `processEvent` or `beforeSendLog`. Fix: type the parameter, for example `spy((event: Event) => event)`.
- `spy()` or `spy(() => x)` with no parameters, when the code calls the spy with arguments. `calls.at(-1)?.args` has type `[]`, so `assert.deepEqual(args, ['arg', 42])` fails to type check. Fix: give the impl its parameters.
- `withStaticSpan(spy(span => span))`: the wrapper hides the spy type, so `.calls` is gone. Fix: keep the spy in its own variable.
- Expected values that differ from the actual type (a wider test table type, an extra key, an invalid unit `'gigabytes'`). Fixes: a generic `TestCase<Expected>`, `assert.deepEqual<unknown>`, and a cast for the unit.
- `assert.equal(buffer.length, n)` on a possibly undefined value. Vitest did not check this. Fix: `assert(buffer)` or `!`.
- `''.isWellFormed` needs a newer `lib`. Fix: a cast to a small structural type.

Where the types helped: the `deepEqual` hint names the `deepEqual<unknown>` escape hatch, so the fix was quick. `assert(value)` narrows, so undefined checks stay as real assertions. The checker found one real mistake: the invalid `'gigabytes'` unit.

Where the types hurt: `deepEqual` needs the expected value to have the actual type, which forces a cast in tests that check partial or deliberately wrong shapes. A bare `spy()` has `[]` args, so the converter must add parameter types.

---

# Merged feedback from eight conversion agents

Each agent converted about 20 files. "N of 8 groups" below counts how many agents hit an issue.

# ubqtest 0.0.16 feedback from the packages/core conversion (sentry-javascript)

Eight agents (groups 0 to 7) converted 8 parts of one vitest suite. /tmp/feedback-types.md did not exist when this merge ran, so it is not included.

Totals from the notes: every group finished all its test files. Passing tests equal baseline in every group (266, 570, 440, 417, 343, 495, 617, 483). No test was skipped, removed, or weakened. Group 3 left test/types/typedef.test.ts as is (it fails like the baseline: "build/cjs doesn't exist please build first").

Environment: ubq 0.0.16, Node 26.5. Groups 3 and 6 ran on Bun because Node could not load src. Groups 0, 1, 2, 4, 5, and 7 ran on Node with a local `module.registerHooks` loader set through `NODE_OPTIONS=--import`.

"N of 8" below means how many groups reported the issue.

## What went smoothly

- `ubq guide` and `ubq guide convert` are complete and accurate (groups 0, 4, 5, 7). The tables map nearly every vitest call. The "Failures after the conversion" table matched real failures (group 4). The Hooks section maps to `setup()` plus `cleanup()` (group 7).
- `ubq convert` is correct for plain cases (groups 1, 3, 5, 6): `it` to `test`, `toBe`, `toEqual`, `toHaveLength`, `toBeUndefined`, `rejects`, `toThrow(regex)`. Message to comment conversion is good. 7 of 23 files in group 2 needed no TODO edits.
- Failure output is good (all groups). It shows the exact assertion, a path-by-path diff (`.parent_span_id actual: undefined expected: (missing)`, `.child.child.name`), the source line, and a rerun command. `(missing)` vs `undefined` found loose `toEqual` cases fast. `ubq failures <run>` lists all type errors.
- `mockImport` works (all 8 groups). It covers the whole import graph below the subject, so a mock of a deep dependency works (groups 0, 1, 4, 6). Its error text is clear: `the mock of ../currentScopes has no export "getCurrentScope", and the code under test imports it. Add "getCurrentScope" to the mock.` It replaced `vi.mock`, `vi.spyOn(moduleNamespace, ...)`, `vi.resetModules` plus dynamic import, and `import('x?update=N')` tricks.
- `mockImport(() => import('../src/x.ts'), [])` gives a fresh module instance (groups 2, 7). The empty list works but the guide does not show it.
- `fakeClock` replaced `vi.useFakeTimers` with little change (groups 0, 1, 2, 3, 4, 5, 6, 7). It restores itself at test end, so `onTestFinished(useRealTimers)` and `finally` blocks are gone. `await clock.tick(ms)` replaced `vi.advanceTimersByTime`. `await clock.runAll()` replaced `runOnlyPendingTimers` (groups 0, 4). The `performance.now()` tests passed (group 7). It also fit a 27-test time suite with one helper (group 2).
- `cleanup()` replaced `afterEach` well (groups 0, 1, 2, 3, 6). It accepts an async callback (group 6).
- `assert.throws` returns the error and `assert.rejects` resolves to it (groups 0, 1, 5). So `toThrowError(instance)` and `rejects.toBe(error)` became identity checks, which are stronger. Example: `assert.equal(await assert.rejects(p, /re/), error)`.
- `spy.calls[i].error` and `.result` let a test prove "does not throw" with a real assertion (group 1, mcpServerErrorCapture.test.ts).
- `assert.snapshot` plus `ubq --update` replaced 11 inline snapshots in zoderrrors.test.ts. The snapshot text is readable (group 4).
- `assert.eventually(() => cond, value)` replaced `vi.waitFor` and `vi.waitUntil` (groups 4, 6).
- `assert.match` with a partial object replaced `expect.objectContaining` cleanly, including nested objects (group 2). `assert.match(args, [{ ... }])` works for an array of the same length with partial objects (group 7).
- `for` loops around `test()` replaced `it.each` and `describe.each` with equal test counts (groups 2, 3, 4, 5). Example counts: baggage 48, filterCookies 22, dsn 39.
- `ubq <file>` and `ubq file:line` are fast, about 1 to 3 seconds per file with the type check (groups 0, 2, 3, 4, 5, 6).
- Running one file at a time worked with several agents in one tree (group 5).

## What was confusing, wrong, or missing

### Converter bugs

These produce wrong code, not only a missing conversion.

1. `toHaveBeenCalledWith` on one spy, used for several different calls, becomes `assert.deepEqual(spy.calls.at(-1)?.args, ...)` on each line. The lines contradict each other, and at least one always fails (7 of 8: groups 0, 1, 2, 3, 4, 5, 7).
   - group 0: client.test.ts, `recordDroppedEvent` checks around the `beforeSend` tests, and `captures debug message`.
   - group 1: prepareEvent.test.ts (dropped events), deferSegmentSpanCapture.test.ts (`buffer_overflow`).
   - group 2: inject-trace-propagation-headers.test.ts wrote the same `calls.at(-1)` line 3 times for `sentry-trace`, `traceparent`, and `baggage`.
   - group 3: logs/internal.test.ts "emits beforeCaptureLog and afterCaptureLog events" (`'beforeCaptureLog'` then `'afterCaptureLog'`).
   - group 4: idleSpan.test.ts "should record dropped idle span". The second check passed and the first failed. If the earlier call matched by luck, half the check would be lost silently.
   - group 5: featureFlags.test.ts. A test called the function twice and the second check passed only because of the first call.
   - group 7: transports/base.test.ts lines 248-249, 309-310, 485-486, 508-510; mcp-server/transportInstrumentation.test.ts (`setAttributes` at 1148 and 1415).
   - The guide says the converted line checks the last call. It does not say that two or more checks on one spy are always wrong. Groups used `calls.some(call => isDeepEqual(call.args, [...]))`, `calls[i]`, or a helper (`wasCalledWith`, `wasSetWith`, `lastArgs`). Suggested converter output: `.calls[i]` or `.calls.some(...)` when a spy has more than one check, or a TODO.
2. `await expect(p).rejects.toBe(x)` becomes `assert.equal(await p, x)` with no TODO. The await throws the rejection and the test fails (4 of 8: groups 1, 4, 5, 7).
   - group 1: mcpServerErrorCapture.test.ts.
   - group 4: supabase.test.ts, "ends the PostgREST span exactly once when the query rejects" and the auth variant.
   - group 5: instrument/fetch.test.ts lines 117 and 143. `vi.fn().mockRejectedValue(error)` became `spy(async () => { throw error })`.
   - group 7: transportInstrumentation.test.ts (2 places).
   - The guide table lists only `rejects.toThrow`. Correct form: `assert.equal(await assert.rejects(p, Error), x)`.
   - Group 3 saw the same for `rejects.toBeInstanceOf(Error)`: it became `assert((await result) instanceof Error)` (transports/offline.test.ts, 2 places). Correct form: `await assert.rejects(result, Error)`.
3. `vi.spyOn(moduleNamespace, 'fn')` becomes `spyOn(moduleNamespace, 'fn', impl)` with no TODO. It fails at run time because ES namespaces are read-only (8 of 8). Error text per group:
   - group 0: `TypeError: Cannot redefine property: setupIntegrations`. Also top-level `vi.spyOn(timeModule, ...)`, 3 places in client.test.ts.
   - group 1: `TypeError: Cannot redefine property: captureException` (mcpServerErrorCapture, mcpServerWrapper).
   - group 2: `TypeError: Cannot redefine property: isBrowser` (metrics/internal, fetch, mcp piiFiltering, dsn). Group 2 called this the most common vitest pattern that will break.
   - group 3 and 6 (Bun): `TypeError: Cannot replace module namespace object's binding with configurable attribute` (trpc.test.ts, requestdata, logs/internal; errors.test.ts, errorClassification.test.ts, captureconsole.test.ts).
   - group 4: `TypeError: Cannot redefine property: getTraceData` (meta, warnAboutIgnoredTransactionOptions, oauthClient, supabase).
   - group 5: capturePolicy.test.ts, semanticConventions.test.ts.
   - group 7: `Cannot redefine property: addOutgoingRequestBreadcrumb`.
   - It cannot work for functions that code imports by name. The converter should emit a TODO that points to `mockImport`. The guide entry for `spyOn(object, key, impl?)` should say a namespace is not patchable (group 3).
4. Spy checks on a real import (group 3, 6). After `spyOn(ns, 'fn')`, the converter writes `assert.deepEqual(fn.calls.at(-1)?.args, ...)` on the real import, which is not a spy. Examples: trpc.test.ts, consola.test.ts, metrics/envelope.test.ts (group 3), `exports.captureException.calls.length` in errorClassification.test.ts (group 6). It type checks only with loose types. The converter should leave a TODO.
5. `expect.stringContaining('x')` and `expect.stringMatching(re)` inside `toHaveBeenCalledWith` or `toEqual` become a bare RegExp in `assert.deepEqual`, for example `assert.deepEqual(spy.calls.at(-1)?.args, [/x/])` (3 of 8: groups 0, 4, 5). Fails with `types differ: string and RegExp`. No TODO is written, because the `expect` hint appears only when `expect` stays in the code. Files: warnOnRemovedBuildOptions.test.ts, client.test.ts:213 (group 0); eventbuilder.test.ts "object with error prop" (group 4); commitEnv.test.ts, featureFlags.test.ts (group 5). Correct form: `assert.match(spy.calls.at(-1)?.args[0], /x/)`.
6. Asymmetric matchers are left in code, sometimes with a TODO on the first statement only, sometimes with none (8 of 8).
   - `expect.objectContaining(...)` stays as `assert.deepEqual(x, expect.objectContaining(...))`: 24 places in client.test.ts (group 0). The line cannot compile in the array form `assert.deepEqual(x, [expect.objectContaining(...)])` (group 2). It is exact, not partial (group 7). Suggested output: `assert.match(...)` (groups 2, 7).
   - `expect.any(Number)`, `expect.any(Array)` (`frames: expect.any(Array)` in eventbuilder.test.ts), `expect.any(Function)`, `expect.any(String)`: run time says `expect is not defined`, TYPE says `Cannot find name 'expect'` (groups 0, 4, 5). Group 5 asks for a one-line hint such as "assert typeof args[1] === 'function'".
   - `expect.arrayContaining([...objects])` inside `toEqual` is left as is (group 0).
   - `expect.not.objectContaining` and `expect.anything()` have no hint (groups 0, 2: piiFiltering.test.ts:99 `attributes: expect.not.objectContaining({'client.address': expect.anything()})`).
   - `expect(x).not.toEqual(expect.arrayContaining(...))` becomes `assert(!isDeepEqual(x, expect.arrayContaining(...)))`. This is always true and looks like a real check (group 3).
   - The hint does not say that `assert.match` is partial at every depth, while `objectContaining` compares nested values fully (groups 0, 4, 6). Groups split the check: `assert.match` for top keys and `assert.deepEqual` for nested ones (eventbuilder.test.ts, public-api.test.ts).
   - Advice: grep for `expect` as well as `TODO` (group 0).
7. Optional chains break in converted code (2 of 8).
   - group 1: `toContainEqual` became `(event.exception?.values?.[0]?.stacktrace?.frames).some(item => isDeepEqual(...))` in 11 places of prepareEvent.test.ts. The parentheses break the chain, so TS reports `TS2532 Object is possibly 'undefined'`, and a missing array throws instead of failing.
   - group 2: `toHaveLength(n)` became `assert.equal((event.exception?.values).length, 5 + 1)`: aggregate-errors.test.ts (2), metrics/internal.test.ts (3). Should be `?.length`.
8. `spy(fn) as EventProcessor` keeps the cast. The cast hides the `Spy` type, so `.calls` is a type error (prepareEvent.test.ts, 8 places) (group 1). Also, `calls[0].args` without `!` or `?.` fails the type check (semanticConventions.test.ts) (group 5).
9. Other wrong shapes:
   - `describe.each` gets the `it.each` hint ("Use a for loop around test()"). The fix is a loop around `describe()` (group 1).
   - A top-level `beforeAll` becomes a block `{ ... };` with a stray `;` (rewriteframes.test.ts) (group 1).
   - `test.each` TODO left but `test` not added to the `ubqtest` import (api.test.ts imported only `assert, describe`) (group 1).
   - `as [..][] as const`, a double assertion, gives TS1355 (group 4).
   - Multi-line `assert.deepEqual(x, [{` with wrong indentation, and `test(\n 'name',\n { timeout }, async () => {` (offline.test.ts "Follows the Retry-After header") (group 3).
   - `vi.mocked(x).mock.calls[0]![0]` became `vi.mocked(...).calls[0]!.args[0]` and `vi.mocked` stays in the code (group 2). Left behind in types: `Mock<any>`, `ReturnType<typeof vi.fn>` (group 6), `ReturnType<typeof vi.spyOn>` (group 4).
   - `not.toHaveBeenCalled()` becomes `assert(!(spy.calls.length > 0))`. It works but reads badly. `assert.equal(spy.calls.length, 0)` gives a better message, but see the narrowing issue (groups 2, 3, 7).
   - `not.toHaveProperty('k')` and `toHaveProperty('a.b')` become `assert(Reflect.has(Object(x), 'k'))`. Correct but odd. The nested-path hint is vague (groups 2, 3).
   - Unused imports stay after spies are removed (`miscModule`, `timeModule`) (group 0).
   - A `test('x', () => { ... })` is not made `async` when the fix needs `await mockImport` (group 2).
   - Test 4 of the form `test(name, () => new Promise(done => {...}))` in group 0 got no TODO and needed a rewrite.
   - `ubq convert` does not format. Groups 0, 1, 4, 5, 6, 7 ran `oxfmt` by hand. Group 6 says the report line with the format command is easy to miss.
10. Files the converter did not parse (3 of 8: groups 0, 3, 5).
   - `not converted test/lib/sdk.test.ts: Unexpected token (41:71)` (group 5). The line and column do not match the HEAD file. sdk.test.ts uses `} satisfies Integration`.
   - fetch.test.ts and get-outgoing-span-data.test.ts: not parsed (groups 0, 5). They have `as unknown as Client` casts and `vi.hoisted`. The cause is not stated.
   - requestdata.test.ts: `not converted ...: Unexpected token (883:4)` (group 3). The cause is `vi.spyOn(mod, 'fn').mockReturnValue({ ... } as ReturnType<...>)` with an object literal argument (3 places). It fails with or without the `as` cast. It converts if the literal becomes a call (`mockReturnValue(makeScope())`).
11. No flag for code that fails in ESM (2 of 8: groups 2, 7). `__filename` and `__dirname` give `ReferenceError: __filename is not defined in ES module scope` (metadata.test.ts, third-party-errors-filter.test.ts, misc.test.ts). `require('crypto')` fails too (misc.test.ts). The converter knows the file is ESM, so it can add a TODO. Other non-erasable syntax: `const enum` in trace.test.ts gets no TODO (group 1). A test class with a parameter property (weakRef.test.ts `constructor(public value: string) {}`) fails to load (group 2).
12. `@vitest-environment jsdom` (2 of 8: groups 1, 7). The converter keeps the docblock and writes no TODO. cacheOrigin.test.ts fails with `document is not defined` (group 1). normalize.test.ts and object.test.ts (group 7). The guide says to tell the user but gives no recipe. Both groups installed jsdom by hand (`new JSDOM().window.document`, `globalThis.Event = ...`, with `cleanup`). Group 1 suggests `import { dom } from 'ubqtest/dom'`.

### Converter TODO hints and gaps

- Hint text does not match the call it is attached to (6 of 8: groups 0, 1, 4, 6, 7, and 3 for the `onTestFinished` case).
  - "A spy gets its implementation as an argument" is attached to `mockReturnValue`, `mockImplementation`, `mockImplementationOnce`, `mockClear`, `mockReset`, and `mock.instances`. It does not say what to do for "once", "reset", "clear", or a spy that a shared helper made (testUtils.ts `tool: spy(noop)`). Workarounds: `spy.calls.length = 0`, a flag in the impl, a mutable variable the spy reads, a `function (this: unknown)` impl that pushes `this`.
  - `expect.assertions(n)` gets the generic `expect` TODO (about `objectContaining`) or none (groups 0, 1, 4, 7). Dropping it is right for sync assertions. For a callback that must run, the zero-assertion rule covers only "at least one". Groups used a counter, `await` plus a final assert on collected values, a `callbackRan` flag, or a call-count assert (client.test.ts 58 tests, trace.test.ts `withActiveSpan`, attachments.test.ts, multiplexed.test.ts 13 tests, base.test.ts, syncpromise.test.ts, promisebuffer.test.ts).
  - `vi.clearAllMocks()` and `vi.resetAllMocks()` get two TODOs: hook, and "Use mockImport" (groups 0, 1, 2). The second is misleading. Spies are new per test, so the correct action is to delete the call. Group 2 says that top-level spies last until file end, so call counts add up across tests. It suggests: "create the spies inside a setup function". The guide table has `vi.restoreAllMocks`, not `clearAllMocks` (group 1).
  - `.not.toThrow()` hint [11] "write an assertion" (groups 2, 3, 4, 5, 6, 7). The right answer is to call the function, then assert on a result. For `void` functions, groups wrote `assert.equal(fn(), undefined)`, a spy call count, or a debug logger spy check. The hint cannot know what to assert but can say this.
  - `onTestFinished(() => { vi.useRealTimers() })` stays in the code with a TODO on the inner call only. No hint says `fakeClock` already restores (group 3).
  - `vi.useFakeTimers()` plus `vi.setSystemTime(...)`: hint "Use fakeClock: const clock = fakeClock({ now: 0 })" does not say to pass the time as `now` (group 3). `fakeClock({ now: 0 })` sets `Date.now()` to 0 and broke idleSpan tests that compute `Date.now() / 1000 - 9999`. The hint should show `fakeClock()` first (group 4). Group 0 set `now: 2020 * 1000` to match an old mock.
  - `vi.stubGlobal` and `vi.unstubAllGlobals`: "ubq has no vi.stubGlobal" with no suggestion (groups 2, 3). Workarounds: `Object.defineProperty(globalThis, name, ...)` with a `cleanup` that restores the old descriptor. Group 2 used it 54 times in time.test.ts. Group 5 wrote a 30-line `stubFetch()` helper.
  - `vi.waitFor`: "ubq has no vi.waitFor" with no hint. `assert.eventually` is the answer (group 4).
  - `describe.runIf` and `it.runIf`: "ubq has no describe.runIf". The hint should point to `{ skip: cond && 'reason' }` from the guide table (group 3).
  - `it.each` and `test.each` TODO "Use a for loop around test()" leaves `%s`, `%j`, callback parameters, and `$name` titles (groups 0, 1, 2, 5, 6, 7). `%s` of an object gives `[object Object]` and `%j` of `NaN`, `Infinity`, `null` all give `null`, which makes duplicate names (see "ubq API and types"). About 20 tables in group 6, about 10 places in group 7, 25 calls in group 4, 9 in group 0. Groups 0, 4, 6 wrote scripts (/tmp/eachconv6.py, /tmp/g4each.py). Simple loops were fine to write by hand (group 3). Suggested converter output: `for (const [..] of table) test(...)`.
  - Hooks hint [6] "Make a setup function and call it in each test" writes nothing (groups 0, 4, 5, 6, 7). Even a plain `beforeEach` that touches no outer variable is not rewritten. Counts of inserted `setup()` calls: 181 tests and 11 hooks (group 0), 128 tests in trace.test.ts (group 1), about 70 lines in tunnel.test.ts and about 180 total (group 5), 100+ in scope.test.ts (group 6), 15 files by regex (group 4). Each test becomes `async` when setup is async (group 5).
  - Hint [4] "Use mockImport" shows `{ fn }` and a path like `../src/a.ts` that is not relative to the test (groups 3, 5). It does not say a full export list is needed, that the real module can be spread, or that a mock applies to nested imports (see "ubq API and types").
  - The convert report prints one TODO line per statement with a hint number only, so the reader needs the hint table to know what hint 8 means (group 1).
  - `expect.stringMatching`, `expect.any(Number)` nested in arrays, `expect.anything()` have no direct form. `assert.match` takes a RegExp for strings but cannot test "any number" (groups 1, 3, 6). Group 1: 38 expected objects in trace.test.ts. Group 6: about 34 uses in feedback.test.ts and about 60 in scope.test.ts. Group 3: session.test.ts, 21 cases, and about 30 places in logs/internal.test.ts. Every group wrote a local helper (`Matcher` plus `assertEqualWithMatchers` of 40 lines; `resolveMatchers` plus `deepEqualWith` of 45 lines copied in two files; `withoutSequence`; `anyString` predicates).
  - `toHaveBeenCalledExactlyOnceWith` has a TODO but no mapping (group 4). Mapping: `assert.equal(s.calls.length, 1)` plus `assert.deepEqual(s.calls[0]?.args, [...])`.
  - `toBeTypeOf` has no hint (group 4). Mapping: `assert.equal(typeof x, 'function')`.
  - `not.toHaveBeenCalledWith()` with no arguments: no hint. Group 6 used `assert.equal(calls.length, 0)`.
  - `toHaveProperty`: groups 2, 4, 6 used `'a.b' in x`, `assert(!(k in obj))`, `assert.notContains(Object.keys(x ?? {}), key)`. Group 4 notes `toHaveProperty(k, v)` as `assert.equal(obj[k], v)` differs slightly when the value is `undefined`.

### ubq API and types

- `assert.equal` narrows its first argument to the expected literal (8 of 8). `assert.equal(x.calls.length, 1)` then `assert.equal(x.calls.length, 2)` gives `TS2345: Argument of type '2' is not assignable to parameter of type '1'`. This is the form the guide recommends for `toHaveBeenCalledTimes`. Files: logger.test.ts (group 0), a `transactions.length` case after `await clock.tick(100)` (group 1), handleCallbackErrors.test.ts (group 2), 6 files (group 3), debounce.test.ts 4 times (group 4), instrument/fetch.test.ts (group 5), scope.test.ts (group 6), handlers.test.ts and base.test.ts:80 (group 7). `assert(!(x instanceof TypeError))` narrows `x` to `never` (group 5). `let _span: Span | undefined = undefined` narrows to `never` after `assert` (group 1). Workarounds: `assert.equal<number, number>(...)`, `const count = () => spy.calls.length`, `(x as number)`, or `assert(!(spy.calls.length > 0))`. Fix: do not narrow mutable values or `number`, or narrow only for `undefined`, `null`, and discriminants. The guide hint covers different types (`<unknown, unknown>`) but not this case.
- `spy()` and `spy(async () => undefined)` have weak types (7 of 8: groups 0, 1, 2, 4, 5, 6, 7).
  - `spy()` is `Spy<(...args: unknown[]) => void>`. It is not assignable to a typed callback (`BeforeSendStaticSpanCallback`, `beforeSend`). `calls.at(-1)?.args` is `[]`, so `assert.deepEqual(args, [true])` is TS2345 (metrics/internal.test.ts). `'event' is of type 'unknown'` for `spy(event => event)` (group 0).
  - Group 0 added parameter types in about 25 places. Group 2 added unused parameters (`(_onlyIfSampled?: boolean) => ...`) for types only.
  - test/lib/integrations/mcp-server/testUtils.ts: `send = spy(async () => undefined)` gives `TS2554 Expected 0 arguments, but got 2` at line 187 (`innerTransport.send(message, _options)`) (groups 2, 5, 6). `connect` and `onmessage` have the same issue (groups 2, 6). Group 4 edited the helper to a loose `noop` (`spy((..._args: any[]): any => undefined)`). Group 7 needed no change. The file is shared, so groups cast locally (groups 2, 5, 6). A default of `(...args: any[]) => any` for `spy()` would remove this (group 4).
  - `spy()` loses the `Spy` type when stored in a typed object (`PromiseBuffer.drain`, `request.setHeader`, `withStaticSpan(spy())`) (group 7).
  - A typed `spy<Fn>()` is not enough when the type is long (group 0).
- `assert.throws(fn, errorInstance)` and `assert.rejects(p, errorInstance)` are type errors: `TS2345 ... 'Error' is not assignable to parameter of type 'ErrorMatch'` (4 of 8: groups 0, 2, 3, 4). The old `toThrow(error)` and `rejects.toThrow(error)` are common. Workarounds: `{ message: error.message }`, or `assert.equal(await assert.rejects(p, Error), error)`.
- `assert.rejects` takes `Promise`, not `PromiseLike` (groups 3, 4). `transport.send()`, SyncPromise, and the supabase mock builder fail. Workaround: `Promise.resolve(x)`.
- `assert.rejects` has no form for a non-Error rejection such as a Symbol (`SENTRY_BUFFER_FULL_ERROR`, promisebuffer.test.ts) (group 4). Workaround: `assert.equal(await p.then(() => undefined, e => e), SENTRY_BUFFER_FULL_ERROR)`.
- `assert.deepEqual(a, b)` checks `b` against `NoInfer<T>` (groups 1, 2, 3, 5, 7). A deliberate mismatch is a type error (`'ms'` is not an `AttributeUnit`; `string | undefined` vs `string`; partial objects; `acs: {}`). Workaround: `assert.deepEqual<unknown>`: 8 times in attributes.test.ts (group 1), 8 places (group 3), about 12 times (group 5), 3 places (group 7). The `hint:` line helps.
- `assert.match` and partial objects: recursive partial (nested objects may have extra keys) (groups 0, 4, 6). vitest `objectContaining` is partial at the top level only. Groups wrote per-key `assert.deepEqual` (about 30 lines, group 0) or split checks. Group 7 says `assert.match` handles "one level of partial". This disagrees with groups 0, 4, 6 and group 2 (nested works). Maintainers should check. `assert.match(x, [..])` needs the same array length (groups 1, 5). `expect.anything()` for a second argument became `{}` and relies on it being an object (group 1).
- No predicate form in `assert.match` (groups 3, 6). Group 6 proposes `assert.match(x, { n: assert.number })` or an `isType` helper. Group 3 notes `assert.match` accepts no predicate and no `any(Number)`.
- `assert.deepEqual` is strict about `undefined` keys, prototypes, and null-prototype objects (all 8 groups). The guide covers this. About 70 tests in group 6 (envelope, spans/envelope, request, url, scope, feedback). Group 6 added `settings: undefined`, `ingest_settings: undefined`, `'url.query': undefined`, `nullProto()` for `Object.create(null)` headers. Group 2: 12 results (9 in spanUtils, 3 in fetch). The converter cannot know it statically. Group 6 suggests a `--loose` flag or a post-run report ("12 failures are undefined-key diffs"). Group 3 kept the old semantics with a `withoutUndefined` helper (JSON round trip) in requestdata.test.ts and session.test.ts. Group 1 made a helper ignore undefined keys in both directions for 38 matcher cases. Error text for null-prototype objects: "types differ: null-prototype object and Object", with no key diff (group 6). Clear enough.
- Duplicate test names are an error (5 of 8: groups 1, 2, 4, 6, 7). vitest allows them. Cases: `it.each([42, 42.0])` (group 1); `should keep the original mechanism type for the root exception` twice in aggregate-errors.test.ts (group 2); `it.each('%s is %s')` with 13 values as `[object Object]` (group 4); should-ignore-span.test.ts case 9 repeats case 7 and request.test.ts PII header cases share one name (group 6); the envToBool.test.ts table has two identical rows (group 7). `%j` of `NaN`, `Infinity`, `null` all give `null` (group 2, used `util.inspect`). The guide says "put the value in the name", which is not enough. Groups added the loop index (`#0`, `(#index)`). Test names with `${}` are not compared by `ubq review` (group 2).
- `describe` name must not contain " > ": `describe('instrument > parseFetchArgs')` fails with `TypeError: describe name must not contain " > "` (group 5). Renamed to `instrument: parseFetchArgs`. This is a test ID change. The guide does not say it.
- Spy API gaps (6 of 8: groups 0, 3, 4, 5, 6, 7).
  - No clear, reset, `mockReturnValue` after creation, `mockReturnValueOnce`, or once-implementation. `spy.calls.length = 0` works. The API does not say that `calls` is writable (groups 4, 7). Suggested: `spy.reset()`, `spy.once()` (groups 0, 7).
  - `spyOn(obj, key)` returns a spy with no way to restore it before test end, nor to change the implementation later (group 0).
  - Removing a `mockClear` inside one test changed counts (`1` became `2`) (scope.test.ts removeAttribute) (group 6).
  - No `this` or `mock.contexts`/`mock.instances` (groups 1, 6). Workaround: a `function (this: unknown)` impl that pushes `this`.
  - Per-test mocks that change value (`getClient`) need a mutable variable and setter (groups 4, 6, 7).
  - No `assert.calledWith(spy, ...args)` (group 7). Any-call checks give `assert` of `false` with a poor message (group 0).
- `mockImport` needs a full mock (7 of 8: groups 0, 1, 2, 3, 4, 5, 6). Error: `the mock of ./misc has no export "addExceptionMechanismToCapturedException"` (group 0). Workaround: `{ ...(await import(real)), fn }` with a static or dynamic import of the real module. Groups used it 15 times (group 5), in about 6 files (group 2), and a "partial" option was requested by groups 0, 2, 6. Group 3: `vi.mock` with a factory has the same rule, but `vi.spyOn` does not. Types must match the real export, so some used `as never` or `as unknown as typeof traceModule.startSpan`, which hides errors (groups 3, 4).
- `mockImport` builds a new instance of the whole local graph under the subject (6 of 8: groups 0, 2, 3, 4, 5, 7).
  - group 0: `new Scope()` from graph A and a `TestClient` from graph B are different classes (`a.Scope !== real.Scope`, `client instanceof c.Client` is false). Shared state still works through the carrier object. Group 0 used `mockImport` in only 7 client tests.
  - group 2: dsn.test.ts needed `debug-logger` in the mock list to spy on `debug.error`.
  - group 4: in oauthClient.test.ts `spyOn(debug, 'error')` did nothing, because the reloaded integration had its own `debug-logger.ts`. Fix: pass the test's own module as the mock: `[() => import('.../debug-logger.ts'), { ...debugLogger }]`. functiontostring.test.ts patches `Function.prototype.toString` once per process, so group 4 loaded one instance at the top level and swapped `getClient` with a mutable variable.
  - group 7: a fresh `debug` object in spanStreaming, fresh `handlers` state in console. Mocks apply to nested imports.
  - group 5: not obvious that each call makes an isolated copy (tunnel.test.ts used two calls).
  - group 3: module state that other modules share (the log sequence counter) still lives in the shared module.
  - The guide says "a new instance of a.ts with a mocked dep.ts" only.
- `mockImport` loader path is written twice (module and mocks list) (group 6). Every use makes the test async (groups 2, 3, 5, 6). Failure line for an error in a `mockImport` module pointed at the register hook file, not the source (group 7). `mockImport` uses its own loader: a user resolve hook worked only after the `?query` was stripped from the URL (group 0). `mockImport` needs `module.registerHooks` (Node 22.15+). `ubq doctor` could say so (group 2).
- `fakeClock` gaps (4 of 8: groups 0, 2, 3, 7).
  - No `setSystemTime(ms)`. It cannot go backwards or move `Date` without running timers (group 2: 38 uses in time.test.ts, wrote a helper that calls `restore()` and `fakeClock({ now })` again; group 7: `spyOn(Date, 'now', () => clock.now + 3_600_000)` on top of `fakeClock`, 2 tests in sentrySpan).
  - No `runOnlyPendingTimers`. `runAll()` worked (group 0). `now` defaults to real time (group 0).
  - The clock replaces `performance.now` on the current global `performance` object. A test that stubbed `performance` and then called `fakeClock` again lost its stub's `now` (group 2, time.test.ts, 3 tests failed, 10 ms off).
- `spyOn` with `fakeClock` on `Date.now` at once: the clock wins, no problem (group 0).
- `spy(...)` shared across tests in a describe (`send` in attachments) is now one spy per test (group 0). This is a behavior change, not a gap.
- `await mockImport` with a mocked module and many tests needs a long `setup()`: 46 lines (console-integration.test.ts), 70 lines for 57 tests (MCP file) (groups 6, 7).
- Type check output:
  - "note: N type errors are in files that this run did not use" is constant noise (about 500 to 2800) (groups 0, 2, 3, 5). Group 3 saw the count fall from 2810 to 677 as more files ran.
  - Group 3: the TYPE block for deep union types (test/lib/utils/envelope.test.ts) prints several thousand characters on one line.
  - Type errors differ between runs of identical code (5 of 8: groups 1, 3, 5, 6, 7). prepareEvent.test.ts: 0 errors in one run, 18 in the next (group 1). scope.test.ts showed 7, then 0 (group 6). A single-file run printed `pass` with no TYPE block, while a 23-file run reported cookie.test.ts:161, base.test.ts:77, get-default-export.test.ts:25, client-subscriptions.test.ts:137, and 11 errors in extractGenAiSpans.test.ts (group 7). Other agents ran ubq in the same tree at once. Maintainers should check for a shared cache or timing effect.
  - Type errors in src make every run `fail` (exit 1) even when all tests pass: "fail: 0 failed, 34 passed, 2 type errors" (group 4). It is hard to see which file owns the failure. Group 2 asks for a way to mark `src/` errors as non-blocking.
  - Type checking test code that vitest never checked found real drift in every group. Examples: `integration.setup!(client, true)`, `ResolvedDataCollection` missing `queues`, missing `WeakRef` with `lib: [es2020]` (groups 2, 4), `@ts-expect-error` comments already unused at baseline (6 in is.test.ts, group 4), zod v4 issue types vs the local `ZodIssue` interface (8 errors, group 4), `ReplayEvent` fixture missing `segment_names` (group 3). The conversion report does not count this work, and the error for `type '{ message: string }'` does not say the fix is an annotation on the variable (group 6).
- Group 3: `ubq-snapshots/` appeared as an untracked folder in the package root with no snapshot test from this group. Group 4 did create `ubq-snapshots/test/lib/integrations/zoderrrors.test.ts.snap`. The origin of the folder in group 3 is not known.
- `spyOn(Reflect, 'apply', ...)` needs explicit parameter types and `any` for the last two arguments to satisfy both overloads (TS7006) (group 4).
- Group 1: `toEqual` of two Promises passes in vitest for any two promises. `assert.equal` checks identity (promisebuffer.test.ts, group 4).

### Loading project source (extensionless imports, parameter properties, build-time defines)

All 8 groups hit these. No test file that imports `src/` loaded without a workaround. Groups 0, 1, 2, 4, 5, 7 each wrote a local loader. Groups 3 and 6 used Bun.

1. Extensionless and directory imports in src (8 of 8). src uses `import { DEBUG_BUILD } from './debug-build'`, `'../utils/debug-logger'`, `'../../src'`, `'./tracing'`.
   - Errors: `the test file did not load: Cannot find module 'src/debug-build' imported from src/eventProcessors.ts`; `Cannot find module 'src/utils/version' imported from src/carrier.ts`; `Directory import 'src/tracing' is not supported resolving ES modules imported from src/index.ts`.
   - The path in the message drops the `./` and points to a path that does not exist (groups 1, 5).
   - The guide says "Import source files with their extension" and `'../src/parse.js'` finds `parse.ts`. It does not say that an extensionless import in src fails (groups 0, 1, 2, 3, 4, 5, 7). Changing test imports does not help, because `src/index.ts` itself imports `'./tracing'` (group 7). The project has hundreds of them (group 5).
   - Workaround: a `module.registerHooks` resolve hook that tries `.ts` and `/index.ts` (groups 0, 1, 2, 4, 5, 7), loaded with `NODE_OPTIONS=--import`. Without the hook only 2 of 10 (group 0), 3 of 21 (group 1), 1 of 23 (group 2), 2 of 24 (group 4), and 0 of 23 (group 7) loaded. Bun resolves extensionless imports, so Bun worked (groups 3, 6).
   - The converter adds `.ts` to relative imports in some test files and helpers (test/mocks/client.ts) but not in all test files (groups 0, 1, 4). Group 4 saw mixed state after `ubq convert` (spanKind.test.ts kept `../../src/spanKind`). Directory imports need `/index.ts`. Groups wrote scripts (/tmp/fiximports4.mjs).
   - Requests: ubq resolves extensionless and directory specifiers itself (as tsc and vite do) (groups 0, 5, 7). `ubq doctor` reports them (group 5). `ubq convert` rewrites relative imports in test files (groups 0, 4).
   - Group 4: /tmp/ubqhook/hook.mjs was overwritten by another agent. Shared hook paths in /tmp are fragile with parallel agents.
2. Parameter properties in src (8 of 8): `src/utils/lru.ts:5` (`constructor(private readonly _maxSize: number)`) and `src/utils/error.ts:11` (`public message: string`).
   - Error: `TypeScript parameter property is not supported in strip-only mode`. The text is clear and names Bun (groups 1, 3, 7). The hint says to use Bun or change syntax. Neither was possible for groups 7 and others (src not editable).
   - Node 26 `module.stripTypeScriptTypes` rejects `mode: 'transform'` (`options.mode must be one of: 'strip'`) (groups 1, 2, 5, 7). `--experimental-transform-types` is "not allowed in NODE_OPTIONS" (groups 0, 2, 7). TypeScript 7 in the repo has no JS API (`ts.transpileModule is not a function`) (groups 1, 2, 5). Group 4 transpiled with the `typescript` package. Groups 0, 1, 2, 5, 7 used esbuild (found in node_modules/.pnpm for group 1).
   - Group 3 tried a Node resolve hook, found it insufficient (needs transform-types as well), and dropped it.
   - `ubq doctor` checks only tsconfig, not src (group 0). A transform fallback or a flag for non-erasable syntax would help (groups 0, 5).
   - The type check reports `TS1294 This syntax is not allowed when 'erasableSyntaxOnly' is enabled` at src/utils/error.ts:11 and src/utils/lru.ts:5 in every run that loads them (8 of 8). It cannot be fixed in the test file. Group 1: 7 files show `fail:` with 0 failed tests (prepareEvent, deferSegmentSpanCapture, trace, cacheOrigin, debug-ids, sdkMetadata, tracePropagationTargets). Group 2: conversationId, fetch, inject-trace-propagation-headers, metadata, metrics/internal, beforeSendSpan, spanUtils. A one-line change in each src file would remove it (group 2).
3. `__DEBUG_BUILD__` is a vite `define` in vite/vite.config.ts (8 of 8). Without it: `ReferenceError: __DEBUG_BUILD__ is not defined at src/debug-build.ts:8`.
   - Workarounds: `globalThis.__DEBUG_BUILD__ = true` in the hook (groups 0, 1, 2, 4, 5, 7), `BUN_OPTIONS=--preload` (group 3), `BUN_OPTIONS="--define __DEBUG_BUILD__=true"` (group 6).
   - ubq has no equivalent of vite `define`. The converter and `ubq doctor` do not read vite `define` or warn (groups 2, 5). Requests: a `globals` or `define` option in the `ubq` key of `package.json` (groups 1, 6, 7), a `"preload": [...]` key to remove `NODE_OPTIONS` (group 2).
4. The vite config has an `esmOnlyPlugin` that strips `rollup-include-cjs-only` blocks from src (5 of 8: groups 1, 4, 5, 6, 7). ubq has no transform hook. Only group 7 needed it: its harness removes the marker blocks. The convert report does not warn about it (group 5).
5. `ubq doctor` says `FIX tsconfig.json: set "allowImportingTsExtensions": true and "erasableSyntaxOnly": true`, but this package keeps both in tsconfig.test.json. Doctor reads only tsconfig.json, which includes only `src` (6 of 8: groups 0, 1, 2, 3, 5, 7; group 7 notes the consequence for the type check). Doctor and the type check disagree for a project whose src is not erasable (group 3).
6. Test files are ESM syntax in a package with no `"type": "module"`. Every run prints `MODULE_TYPELESS_PACKAGE_JSON` and `Reparsing as ES module` (group 1). The guide does not mention it.
7. `bun node_modules/.bin/ubq`, as the guide says, fails with "Syntax Error", because `.bin/ubq` is a shell shim (group 6). The working form is `bun node_modules/ubqtest/cli.js <file>`. The guide should give the real path.

### Guide and docs

- Say that extensionless imports in src fail, and what to do (groups 0, 1, 2, 3, 4, 5, 7).
- Say that an ES module namespace is not patchable by `spyOn` and that the converter does not flag it (groups 3, 6). Show `mockImport` with `{ ...(await import(real)), fn: replacement }`. The guide example mocks a module with one export (groups 0, 2, 3, 5, 6).
- Document that `mockImport` mocks apply to nested imports, that each call makes its own graph, and that `[]` is valid for a fresh instance (groups 2, 4, 5, 7).
- Document `calls` as writable and give a reset recipe (groups 4, 7).
- Add `vi.stubGlobal` and `vi.clearAllMocks` to the table. Add recipes for `describe.each` (loop around `describe`), `expect.assertions(n)`, `not.toThrow`, jsdom, `toHaveProperty`, `toBeTypeOf`, `toHaveBeenCalledExactlyOnceWith` (groups 0, 1, 2, 4, 7).
- The guide's `assert.equal` type hint covers different types only. It lacks the repeated-counter case (groups 2, 6).
- Say that `describe` names must not contain " > " and that duplicate test names fail (groups 1, 5).
- Say that `MODULE_TYPELESS_PACKAGE_JSON` is expected without `"type": "module"` (group 1).
- A `fakeClock()` example before `fakeClock({ now: 0 })` (group 4). Say that `fakeClock` overwrites a stubbed `performance.now` (group 2).
- Say how to run on Bun (group 6).
- Group 3: `ubq guide convert` steps 2 and 3 expect a clean `git status` and a commit. In this run the harness did the conversion. Not a problem, noted only.
- Group 2 asks `ubq doctor` to mention the `module.registerHooks` need for `mockImport`.

## Improvements over vitest

- A test with zero assertions fails (all 8 groups). Real cases found:
  - group 0: attachments.test.ts called `client.captureEvent(...)` without awaiting, and `expect.assertions(4)` passed only because the transport callback ran later. flushIfServerless.test.ts leaked `GLOBAL_OBJ[Symbol.for('@vercel/request-context')]` and replaced `global.process` without restoring it. Later tests passed only because of the leak.
  - group 4: syncpromise.test.ts and promisebuffer.test.ts. Callbacks that never ran would have passed before. Assertion errors inside `.then(null, ...)` handlers can no longer be swallowed.
  - group 5: 3 tests in vercelWaitUntil.test.ts with no assertion ("No assertions needed, just ensuring no errors are thrown").
  - group 7: 2 "does not throw" tests in handlers.test.ts, "disallows invalid attribute types" in sentrySpan.test.ts (only `@ts-expect-error` lines).
- Strict `deepEqual` found loose old tests.
  - group 1: rewriteframes.test.ts "no frames" (`stacktrace: { frames: undefined }`); prepareEvent.test.ts 7 `toEqual` calls hid `breadcrumbs: undefined`; prepareEvent.test.ts `applyDebugIds` two `not.toContainEqual(expect.objectContaining({ filename3: ... }))` with a typo key, so the check could never fail; casts like `{ trace: { data } } as Event` and `error.cause.baz = 1`.
  - group 2: 12 loose `toEqual` results (9 in spanUtils, 3 in fetch); duplicate test name in aggregate-errors.test.ts; vacuous `expect(attributes).not.toEqual(expect.arrayContaining([...]))` in metrics/internal.test.ts "does not include SDK metadata" (replaced with `'sentry.sdk.name' in attributes === false`); a client set in `beforeEach` and never removed in spanUtils.test.ts.
  - group 3: `.attrs.environment actual: undefined expected: (missing)` in session.test.ts; same vacuous shape in logs/internal.test.ts and server-runtime-client.test.ts "does not add server.address attribute when serverName is not set".
  - group 4: promisebuffer `rejects.toThrowError()` accepted a Symbol; eventbuilder.test.ts `toEqual({ __serialized__: customClassInstance })` passed against a plain object copy; idleSpan.test.ts DSC ignored `org_id` and `release`; syncpromise.test.ts checked a build detail (`Reflect.has(Object(promise), '_value')` is false under vitest and true under native class fields).
  - group 5: scopeData `conversationId: undefined`, fetch.test.ts `'server.port': undefined`, 6 stacktrace tests missing `module: undefined`.
  - group 6: about 70 undefined-key expectations, null-prototype headers, a repeated should-ignore-span case.
  - group 7: traceData.test.ts expected `{ span: undefined }` but code passes `{}`; sentrySpan.test.ts "build TransactionEvent" needed 6 explicit `undefined` keys; object.test.ts "ignores class instance" can compare with `new MyClass()`; the `isElement` spy in normalize.test.ts "extracts data from Event objects" was never called.
- Real type checking of tests. About 15 type fixes in group 3 and about 20 pre-existing errors in group 5 (tunnel.test.ts `Request` body type, `net.connect(port, cb)` overload, `getTunnelPath()` returning `string | undefined`, `@ts-expect-error` lines made unused by narrowing). More in groups 1, 2, 4, 6, 7 (see "ubq API and types").
- Fresh spies per test remove `vi.clearAllMocks`, `vi.resetAllMocks`, and `afterEach(() => vi.restoreAllMocks())`. No shared mock state (groups 0, 1, 2, 3, 4, 5, 7). Examples: trpc.test.ts shared module-level spies and relied on `clearAllMocks` (group 3); `mockReturnValue` in transportInstrumentation.test.ts stayed set across tests in vitest because `clearAllMocks` keeps implementations (group 7).
- `mockImport` is local to one test (groups 0, 2, 3, 5, 7). No hoisting rule, no `var debugBuild` with a "must be var because vi.mock hoists" comment (group 0). `DEBUG_BUILD` as `let mockDebugBuild` in dsn.test.ts became `setup({ debugBuild: false })` (group 2). `vi.mock` was file-wide, so earlier tests in logs/envelope.test.ts silently ran against mocked modules (group 5). Each test gets fresh module state, better than `vi.resetModules()` (group 0).
- `cleanup()` next to the code that needs it is easier to follow than a distant `afterEach` (groups 2, 3). It forced restore on failure: `globalThis.fetch`, `process.env`, `originalConsoleMethods` in vercelWaitUntil.test.ts (group 5).
- Each test file runs in its own process: the `Function.prototype.toString` patch in functiontostring.test.ts no longer leaks to other files (group 4). No leaks between files (groups 6, 7).
- A test file is a plain program with no globals and no hoisting, so file order matters and imports show what the test uses (groups 0, 1, 3, 7). Type check and coverage run in one command (groups 0, 7).
- `assert.match(actual, partialObject)` is shorter than `toMatchObject` plus `expect.objectContaining` and checks array length (group 5).
- Group 2: `assert.rejects`/`throws` identity checks and `assert.equal(thrown, toolError)` are stronger than `toThrow(toolError)`, which compares only the message (group 1).
- Group 6: `fakeClock` and `env()` restore themselves. No `finally` blocks.
- Group 6: Required `await` rules remove silent passes. Group 3: unawaited `rejects` rule caught the offline test (`rejects` conversion would have passed silently as a thrown error).
- Some changed tests are stronger on purpose: `not.toHaveBeenCalledWith()` became a call count of 0 (group 6); `sdkMetadata.test.ts` `expect.any(String)` became `SDK_VERSION` (group 1); `mcpServerWrapper.test.ts` `not.toThrow()` became a call-count check (group 1).

## Worse than vitest

- Verbosity in call checks (8 of 8).
  - `toHaveBeenCalledWith(a, b)` is `assert.deepEqual(s.calls.at(-1)?.args, [a, b])` (last call only, with optional chain noise). Any-call form: `assert(s.calls.some(c => isDeepEqual(c.args, [a, b])))`. `toHaveBeenNthCalledWith(n, ...)` is `spy.calls[n - 1]?.args` and an off-by-one is easy (group 1).
  - `expect(spy).toHaveBeenCalledWith(expect.objectContaining({a: 1}), expect.anything())` becomes 3 lines: `const args = spy.calls.at(-1)?.args; assert(args); assert.match(args[0], { a: 1 }); assert(args[1] != null);`. This appears more than 50 times in group 2 files.
  - Group 5: files grew from 8009 to 8430 lines (about 5 percent after oxfmt). Group 1: trace.test.ts 991 added and 845 removed lines for `describe.each` re-indent.
- No asymmetric matchers: `any`, `anything`, `stringMatching`, `objectContaining` nested, `arrayContaining` (8 of 8). Each use became 2 to 6 lines (group 0) or a local helper (groups 1, 3, 6).
- No hooks (8 of 8). `beforeEach` setup needs a `setup()` line in every test. Counts are in "Converter TODO hints and gaps". A test that forgets it runs with stale state with no warning (groups 0, 1, 2, 3, 5), or a runtime ReferenceError from a forgotten destructure (group 3). Group 2 has describes with 10 to 30 tests (third-party-errors-filter 29, metrics/internal 39) and asks for an automatic check that a test calls `setup()`. No group-level setup in `describe.each` loops: nested `beforeEach` becomes a `setup()` call per test, 35 tests in supabase.test.ts (group 4). Describe-level state such as `let fetchMock` assigned in `setup()` works only because tests run one at a time (group 5). Each `describe` needs its own named setup (group 7). A mocked describe-level server (client-subscriptions) needs top-level `await` and `cleanup`, so it starts for the whole file (group 7). Group 7 says `vi.mock` hoisting was shorter for the 57-test MCP file.
- No `vi.mock` hoisting, and no namespace `spyOn` (8 of 8). Every mocked module needs an async `mockImport` in every test or `setup`, a spread of the real module, and a module-level `let` for the loaded function (capturePolicy.test.ts, semanticConventions.test.ts). The module under test is no longer a static import (group 4). Each call loads a new module graph, which is slower (group 1). Group 3: about 7 files changed shape. Group 3 calls namespace spying the largest conversion cost after the missing extension support.
- No `stubGlobal` (groups 0, 2, 3, 4, 5).
- No `toHaveProperty`, `not.toThrow`, `toBeTypeOf`, `toBeCloseTo`, `toBeCalledTimes`, `toBeInstanceOf` shorthand, `toHaveReturned`, `mockRestore` (groups 0, 1, 2, 3, 4, 5, 6, 7). Group 5 wrote an `assertLacks` helper because `assert(!('key' in obj))` needs a typed non-null object.
- No spy clear, once, reset, `mockReturnValue` after creation (groups 0, 3, 4, 5, 6, 7). Group 5 wrote a 30-line `stubFetch()` with `resolve`, `resolveOnce`, `rejectOnce`, `implementOnce`.
- Type noise from strict generics: about 40 edits for types only (group 0), casts in tests that compare unlike types (group 7).
- `describe.each` and `it.each` need manual rewrite (groups 0, 1, 2, 4, 5, 6, 7).
- `assert.equal` narrowing makes natural test code fail the type check (groups 1, 3).
- No hooks plus `mockImport` plus `fakeClock`: group 7 says a test that checks time and spies on `Date` needs a workaround.
- A project not written for Node strip-only mode needs a lot of setup (loader, define, transform) before the first test runs (groups 1, 3, 7). Type errors in src that a test author cannot fix fail every run (groups 3, 4).
- `mockImport` reloads transitive modules, so state that lives in a module (the `debug` object) differs between the test and the code under test (groups 4, 7).
- Each `vi.fn()` used to accept any arguments. `spy()` does not, so explicit parameter types are needed (groups 0, 1, 2, 5).
- `assert.rejects` for thenables needs `Promise.resolve(x)` (groups 3, 4).
- In `describe.each` to `for` loop, `${}` in names makes `ubq review` skip name comparison (group 2).

## Suggestions

Priority 1 (blocks loading or gives wrong results).

1. Resolve extensionless relative and directory imports in src (try `.ts`, `/index.ts`), or add a config option. Fix the error text: it drops `./` and names a path that does not exist. (8 of 8)
2. Transform non-erasable TypeScript (parameter properties, `const enum`) when strip-only fails, or support a loader. `ubq doctor` should check src for it. Do not report a TS1294 error in src as a blocking failure for a test file (or let users mark `src/` errors non-blocking). (8 of 8)
3. Add a `ubq` config key in package.json for `define`/`globals` and `preload`, so `__DEBUG_BUILD__` and a custom loader need no `NODE_OPTIONS`. Add a transform hook or document a replacement for vite plugins such as `esmOnlyPlugin`. (8 of 8 and 5 of 8)
4. Do not narrow `assert.equal`'s first argument to a literal for mutable values or `number`. (8 of 8)
5. Converter: when one spy has two or more `toHaveBeenCalledWith` lines, emit `.calls[i]` or `.calls.some(...)`, or a TODO. (7 of 8)
6. Converter: convert `rejects.toBe(x)` and `rejects.toBeInstanceOf(E)` to `assert.rejects`, or write a TODO. (5 of 8)
7. Converter: write a TODO for `spyOn` on an `import * as ns` or on any real import, and point to `mockImport`. Do not emit `.calls` checks on a real import. (8 of 8)
8. Converter: write a TODO for every `expect.*` left in code, including `stringContaining` and `stringMatching` that turn into a bare RegExp. Emit `assert.match` where possible. (8 of 8)

Priority 2 (large manual work).

9. Add a way to say "any number", "any string", "any function" in `assert.match` and `assert.deepEqual` (for example `assert.match(x, { n: assert.number })`, or `isType`), with strict key checks kept. (8 of 8)
10. Add a `partial` option to `mockImport`, or spread the real module by default, so `{ ...real, fn }` is not needed. Show the form in the guide and in hint [4]. (7 of 8)
11. Add `setSystemTime(ms)` to `fakeClock` (backward and with no timers). Add `stubGlobal(name, value)` with automatic restore. (4 of 8 and 5 of 8)
12. Add spy `reset`, once-implementation (`once`), and `mockReturnValue` after creation. Say that `calls` is writable. Record `this`. (6 of 8)
13. Type `spy()` with no argument as `(...args: any[]) => any`, or infer the parameters from the target type. Fix test/lib/integrations/mcp-server/testUtils.ts (`send`, `connect`, `onmessage`). (7 of 8)
14. Accept an Error instance in `assert.throws` and `assert.rejects` (compare by message like `toThrow(error)`), accept `PromiseLike`, and add a form for non-Error rejections. (4 of 8, 2 of 8, 1 of 8)
15. Converter: write `for` loops for `it.each`, `test.each`, `describe.each`, with unique names (index) for `%s` and `%j`. Include the loop index in the name when values repeat. (7 of 8)
16. Converter: insert `setup();` calls for hooks that touch no outer variable. Add a check that flags tests which skip a `setup()` that others call. (8 of 8)
17. Converter: add `.ts` and `/index.ts` to relative imports in all test files, not only some. (3 of 8)
18. Check type error counts that change between runs of identical code and between single-file and multi-file runs (shared cache or timing). (5 of 8)

Priority 3 (hints, docs, polish).

19. Fix hint texts: `mockClear` and `mock.instances` (not "implementation as an argument"), `expect.assertions` (own text), `vi.clearAllMocks` (delete the call), `.not.toThrow()` ("call the function, then assert on its result"), `describe.each` (loop around `describe`), `describe.runIf` (point to `skip`), `vi.waitFor` (`assert.eventually`), `vi.stubGlobal` (recipe), `fakeClock()` before `fakeClock({ now: 0 })`, and the mockImport path. Print the hint text, not only the hint number, in the report. (6 of 8 for the group of mismatches)
20. Converter: add a TODO for `__filename`, `__dirname`, `require(...)`, `const enum`, and `@vitest-environment jsdom`. Offer a jsdom recipe or helper. (3 of 8)
21. Converter: keep `as` casts out of `spy(...) as T`, do not emit `(a?.b).some(...)` or `(a?.b).length`, do not emit `as const` after `as`, do not leave a stray `;` after `beforeAll`, add `test` to the import. (3 of 8)
22. Converter: fix the parse failures (`satisfies`, object literal in `mockReturnValue(...)`, `as unknown as Client`, `vi.hoisted`), and report the right line and column. (3 of 8)
23. Format output, or print the formatter command in a visible line. (6 of 8)
24. Guide: say that extensionless src imports fail, namespaces are not patchable, mock graphs are transitive, `[]` is valid, `describe` names cannot contain " > ", `MODULE_TYPELESS_PACKAGE_JSON` is expected, and give the real Bun path (`bun node_modules/ubqtest/cli.js`). Add `toHaveProperty`, `toBeTypeOf`, `toHaveBeenCalledExactlyOnceWith`, `clearAllMocks` to the table.
25. `ubq doctor`: read tsconfig.test.json, report extensionless src imports, vite `define`, and the `module.registerHooks` need of `mockImport`.
26. Reduce the "note: N type errors are in files that this run did not use" noise, and print long TYPE blocks for deep union types on several lines. Report the source line, not the hook file, for errors inside a `mockImport` module.
27. Add `assert.calledWith(spy, ...args)` (any call) and an nth-call form. Add `assert.match` predicate support. Check the `assert.match` partial depth against groups 0, 4, 6 (recursive partial) and group 7 ("one level").
28. Add a `toHaveProperty` helper (a `has` assertion) and a `typeof` helper. (6 of 8)
