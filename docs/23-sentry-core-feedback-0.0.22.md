# ubqtest feedback: converting packages/core

ubqtest 0.0.22, Node 26.5.0, TypeScript 7.0.2, macOS arm64.
Date: 2026-11-19. Nothing is committed.

## Result

All tests of `packages/core` run under ubq. Each file has the same
test count as in vitest.

| | vitest (before) | ubq (after) |
| --- | --- | --- |
| Test files | 171 | 172 (one new: `test/lib/utils/error.test.ts`) |
| Passed | 3691 | 3694 (3691 + `typedef` + 2 new) |
| Skipped | 1 | 1 (same test, now with a reason) |
| Failed | 1 (`typedef`: needs `build/`) | 0 with a build, 1 without |
| Type errors in tests | not checked | 0 |
| `ubq check` | n/a | pass |
| `pnpm lint` | clean | 1 warning (see "Do not prefer") |

I checked the per-file counts against the vitest JSON report with
`ubq sql`. Every file matches. The only extra tests are the 2 in the
new file.

Times for a full run, with the type check included:

- Cold, with no `.ubq` folder: 6.9 s.
- Warm: 4.6 s.
- vitest reported 2.8 s for its test phase, not counting its start.
  This is not the same measure, so do not compare the two closely.
- The first ubq run after `ubq convert` took 62 s. It had 2641 type
  errors and 546 failures.

## What changed outside the test files

- `package.json`: `"test": "ubq"`, removed `test:watch`, added
  `ubqtest` and `"ubq": { "define": { "__DEBUG_BUILD__": true } }`.
- `vite.config.ts`: deleted. `tsconfig.test.json` no longer includes
  it.
- `test/tsconfig.json`: added `allowImportingTsExtensions` and
  `rewriteRelativeImportExtensions`, as `ubq doctor` asked.
- `src/utils/error.ts`, `src/utils/lru.ts`: parameter properties
  changed to plain fields, so that Node can strip the types. You
  chose this over a transform or Bun. `ubq check` then wanted a test
  for `SentryError`, so I added `test/lib/utils/error.test.ts`.
- `pnpm-workspace.yaml`: `ubqtest@0.0.22` added to
  `minimumReleaseAgeExclude`. Without it, pnpm installed 0.0.19.
- `ubq-snapshots/`: one new file for 11 zod inline snapshots.

## How the work went

1. Recorded the vitest result as JSON (per-file counts).
2. `ubq doctor` gave 4 `FIX` lines. Each was clear. One line asked
   me to stop and ask you about non-erasable syntax, and I did.
3. `ubq convert test` took 1 s. It changed 173 files and left 1690
   `TODO(ubq)` comments.
4. I fixed the shared helpers, then gave 8 agents about 22 files
   each. Each agent had a brief and the vitest counts. They took
   7 to 18 minutes each, and about 2.3M tokens in all.
5. Final run, count check, lint, format, `ubq check`.

TODO kinds, most common first. The counts are approximate, from the
first sentence of each TODO:

| TODOs | Kind |
| --- | --- |
| ~350 | `expect.any` / `objectContaining` in an exact comparison |
| ~210 | fake timers |
| ~110 | spy implementation on a later line (`mockReturnValue` and similar) |
| ~107 | `expect.assertions(n)`: "delete this call" |
| ~110 | `vi.clearAllMocks` / `mockClear` |
| ~75 | hooks |
| ~75 | `vi.spyOn` on a module namespace |
| ~70 | `toHaveProperty('a.b')` |
| ~65 | `vi.mocked` |
| ~60 | `it.each` that the command could not loop |

## Went smoothly

- **`ubq doctor`.** Each `FIX` line named the files and the exact
  change. The non-erasable syntax line listed 3 test files and 2
  source files, and said not to choose for the owner.
- **`define` key.** `__DEBUG_BUILD__` needed one line of JSON. An
  earlier attempt with 0.0.16 needed
  `BUN_OPTIONS="--define ..." bun node_modules/ubqtest/cli.js`.
- **Convert speed and safety.** 1 s for 171 files. It ran oxfmt
  itself. Running it again on one file from `git show HEAD:...` gave
  the same result, which let one agent recover from a bad edit.
- **Plain mappings.** `it` to `test`, `toBe`, `toEqual`, and
  `toThrow` were right in each file that had no TODO.
- **Simple hooks.** `beforeEach`/`afterEach` that assign no outer
  variable became `setup()` plus `cleanup()` with no help.
- **`fakeClock`.** A direct swap in about 200 places
  (`debounce.test.ts`, `idleSpan.test.ts`, `time.test.ts`).
- **`spy.results(a, b)`.** A clean swap for chained
  `mockReturnValueOnce`.
- **`mockImport(() => import(x), [])`.** A clean way to get a new
  module instance. It replaced the `?update=${n}` query trick in
  `time.test.ts`.
- **The `mockImport` "mock replaced no import" check.** Each agent
  said this made them trust that a mock took effect.
- **`deepEqual` failure output.** It names the path and says
  `actual: undefined expected: (missing)` or `note: types differ:
  null-prototype object and Object`. Two agents fixed many tests with
  a script that read this output.
- **The `hint:` line on type errors.** It gave the exact fix
  (`assert.equal<unknown>(a, b)`).
- **The `since run N ... changed: file:line` line.** When my lint
  cleanup removed one name too many, the failure pointed at the
  exact line I had changed (`spanStreaming.test.ts:89`).
- **`ubq <file>` with "N type errors in other files".** It let 8
  agents work in one tree at the same time.
- **`ubq check`.** It caught my source change with no test.

## Improved over vitest

The strict rules found real defects that vitest hid:

- **Tests that checked nothing.**
  - `handlers.test.ts`: two tests had no assertion. One passed only
    because the test before it had set module state.
  - `vercelWaitUntil.test.ts`: three tests had no assertion.
  - `sentrySpan.test.ts:665`: the test had only `@ts-expect-error`
    lines.
- **Checks that could never fail.**
  - `not.toHaveProperty('sentry.replay_id')` and similar: vitest
    reads the dots as a path, so the flat attribute key was never
    checked (`logs/internal.test.ts`, `metrics/internal.test.ts`,
    `requestdata.test.ts`, `modernMetadata.test.ts`).
  - `not.toEqual(arrayContaining(...))` on an object.
- **Mocks that leaked from test to test.** The vitest config has no
  `restoreMocks`, so later tests in `fetch.test.ts` ran with module
  spies that earlier tests had set. A `spanUtils.test.ts` test passed
  only because of the order of the tests.
- **Duplicate test names.** These were in `aggregate-errors.test.ts`
  and `tracePropagationTargets.test.ts` (a RegExp prints as `{}` in
  `%j`). vitest ran both with no warning.
- **Type errors in tests.**
  - 14 unused `@ts-expect-error` lines, one of which hid a false
    claim about `isInstanceOf`.
  - A stale argument to `makeTransactionEvent`.
  - `sendDefaultPii` passed after the option was removed.
  - Fixtures with a missing required key (`SpanJSON.status`,
    `ReplayEvent`).
  - `unit: 'ms'`, which is not an `AttributeUnit`.
  - A `net.connect` call that matches no overload.
  - `build/types` imports that work only after a build.
- **Loose `toEqual`.** It ignored `undefined` keys, class versus
  plain object, and null-prototype objects. The new expected values
  are exact.
- **`expect.assertions(n)`.** An awaited value or a `cleanup()`
  check replaced it. A failed check in a callback can no longer go
  unseen.

## Confusing

- **`ubq failures` with no run number** shows the newest run in the
  store. With parallel agents in one tree, that was often another
  agent's run. All 8 agents hit this. A default of "the last run of
  this process or terminal", or a run number in every summary hint,
  would help. The summary line has the number, but agents did not
  read it first.
- **`fakeClock().tick(0)`** runs only `setImmediate` callbacks.
  `vi.advanceTimersByTime(0)` runs `setTimeout(fn, 0)`. The TODO says
  "use `clock.tick(ms)`", so `tick(0)` is the natural edit, and then
  the timer never runs. Only `types/clock.d.ts` says this. All 5
  tests in `reportSdkConfig.test.ts` failed until `tick(1)`.
- **The `toHaveProperty('a.b')` TODO.** It starts with "a path of
  keys". vitest first checks for an own key with that literal name.
  Sentry attribute keys have dots (`sentry.message.template`), so the
  first sentence leads to the wrong assertion. `segmentNameSource.test.ts:69`
  passed in vitest only because of the literal-key check.
- **DOM TODOs where no DOM is needed.** `ubq convert` wrote "this file
  needs a DOM" for `@vitest-environment node`
  (`stringifyForCodeInjection.test.ts:2`). It also did this for a
  jsdom file whose tests use no DOM (`object.test.ts:2`).
- **Spies with no parameters.** `spy(() => x)` types `calls[i].args`
  as `[]`. Each converted `toHaveBeenCalledWith` is then a type error.
  This was the most common type error. With `assert.match`, the
  message is about `Predicate` and does not point at the spy.
- **`assert.match<unknown>`** is a type error (TS2558), while
  `equal<unknown>` and `deepEqual<unknown>` work.
- **`undefined` in a `match` pattern** requires that the key exists.
  The guide does not say so.
- **No way to show a cross-realm difference.** For objects from a
  `vm` context, `deepEqual` printed the same text for actual and
  expected, with no `types differ` note
  (`stringifyForCodeInjection.test.ts:36`).
- **Failure output for `calls.some(call => isDeepEqual(...))`.** It
  prints the whole values with no path to the difference. In
  `fetch.test.ts` the only difference was `'server.port': undefined`.
- **`ubq sql`** gives no schema hint when a column name is wrong.
- **Hook order.** `ubq convert` turned an outer `beforeEach` into
  `setup()` in each test, but left an inner `beforeEach` as a hook
  with a TODO. The inner hook then ran before the outer setup, the
  reverse of vitest (`mcp-server/semanticConventions.test.ts`).
  Separately, when the outer hook kept its TODO, convert still made
  inner `setupN()` functions that do not call the outer setup
  (`client.test.ts`). Nothing warns about that.
- **`ubq review`** shows only the `package.json` change. It cannot
  compare vitest tests with ubq tests, so it gives no help in
  reviewing the conversion itself. The guide says this, but the
  conversion is the change that most needs review.
- **Setup function names** like `setup2`, `setup3`, `setup4` in one
  file.

## `ubq convert` changes that were wrong and had no TODO

These are the most useful items. Each passed through with no TODO
and failed later, at run time or in the type check.

Broke at run time:

- **Missing `;` after an inserted `setup()`** (`debug-ids.test.ts`).
  The next line started with `(`, so JavaScript read
  `setup()((globalThis as any)._sentryDebugIds = ...)`. oxfmt then
  joined the lines. 10 of 12 tests failed with "setup(...) is not a
  function". This is the worst one: it is silent, and it looks like
  a test failure. The same can happen before a line that starts with
  `[` or a template literal.
- **`testutils.ts`**: convert removed `import { it } from 'vitest'`,
  but the helper still returned `it` and `it.skip`. There was no
  TODO. Each file that imports the helper failed to load.
- **`rejects.toThrowError()` with no argument** became
  `assert.rejects(p, Error)`. vitest passes this for any rejection.
  The code rejects with a Symbol, so the tests failed
  (`promisebuffer.test.ts:22`, `:78`).
- **Dynamic import with a query string**
  (`` import(`../src/utils/time?update=${n}`) ``) stayed. Every test
  in `time.test.ts` failed with "Cannot find module".
- **A bare `require`** stayed (`node.test.ts:5`). The file did not
  load.
- **`listener.mock.instances[0]`** stayed (`bindScopeToEmitter.test.ts`),
  and so did a later-line `mockImplementation(...)` on a spy that came
  from `vi.fn(impl)` (`transports/base.test.ts`). Both were TypeErrors
  at run time. The same file got a TODO for the other
  `mockImplementation` calls.

Type errors (correct at run time, or a crash only when the value is
missing):

- **`?.` lost before a method or property:**
  - `toHaveLength(n)` on an optional value became `x?.y.length`
    (`aggregate-errors.test.ts`, `extractGenAiSpans.test.ts`,
    `metrics/public-api.test.ts`, about 20 places).
  - `toContainEqual` became `a?.frames.some(...)`
    (`prepareEvent.test.ts`).
- **`it.each` tables with no types.** The guide says the command
  adds `as [..][]`. In at least 10 files it did not, so mixed rows
  became unions (`checkin`, `request`, `supabase`, `tracePropagation`,
  `spanstatus`, `breadcrumb-log-level`, `fetch`, `cookie`, `url`,
  `eventbuilder`).
- **`not.toBeInstanceOf(C)`** became `assert(!(x instanceof C))`,
  which narrows `x` to `never` (`instrument/fetch.test.ts:127`).
- **`import { type Mock }` removed** but `as Mock` kept (`sdk.test.ts`).
- **`vi.fn<() => boolean | number>()`** became a spy with no
  parameters (`trace.test.ts`).
- **`vi.fn().mockResolvedValue(undefined)`** became
  `spy(async () => undefined)` with no parameters, in a shared helper
  (`mcp-server/testUtils.ts`). Every `send(msg)` call in 6 test files
  was then TS2554.
- **`typedef.test.ts`** had no assertion after the conversion and got
  no TODO. With a build present, ubq would fail it for zero
  assertions.

Changes that are correct but change meaning, with no TODO:
`toHaveBeenCalledWith(x)` became
`assert(s.calls.some(call => isDeepEqual(call.args, [x])))`. This is
stricter than vitest (no `undefined`-key or class tolerance). It
found real loose checks, but a note would help.

## Do not prefer

- **No `isMatch`.** This was the top request from 6 of 8 agents.
  There is `isDeepEqual`, but no boolean form of `assert.match`, and
  a caught assertion failure still fails the test. So
  `toHaveBeenCalledWith(expect.objectContaining(...))` loses its "any
  call" meaning. Each case became `calls[0]`, a hand-picked
  `calls.find(...)`, or a hand-written predicate. With `isMatch`,
  most of these would be mechanical:
  `assert(s.calls.some(c => isMatch(c.args, pattern)))`.
- **No exact comparison with one wildcard.** `expect.any(Number)` in
  a large object has no short form. `assert.match` is partial at each
  depth, so it is weaker. To stay exact, agents copied the actual
  value into the expected object (29 times in
  `logs/internal.test.ts`, about 12 in `trace.test.ts`).
- **`mockImport` in place of `vi.spyOn(namespace, fn)`** is much
  longer. One-line spies became 20 to 30 lines of typed setup per
  file (`integrations/fetch.test.ts`, `errorClassification.test.ts`).
  Each call loads a new copy of the module graph, so `instanceof`
  with a top-level class fails, and shared module state must be
  passed in as the real instance. A spy deep in the call graph needed
  two levels of `mockImport` (`transportInstrumentation.test.ts`).
  Generic exports (`getClient<C>`) need casts. The suite has 62
  `mockImport` calls now.
- **No file-wide module mock.** `client.test.ts` (5000 lines, 4 entry
  modules) had a file-wide `vi.spyOn(timeModule,
  'dateTimestampInSeconds')`. A `mockImport` for each test was not
  practical, so it became `spyOn(Date, 'now')`, which touches more
  code.
- **Async ticks.** There is no sync `clock.tick`. A tick inside a sync
  callback forced an async callback, which changes the code under
  test (`idleSpan.test.ts:212`). Every test with timers became
  `async`.
- **`spy` does not record `this`.** `mock.contexts` and
  `mock.instances` need a hand-written replacement. This leaves the
  one lint warning (`no-this-alias`, `bindScopeToEmitter.test.ts:435`).
- **No "first call only" form** (`mockImplementationOnce`,
  `mockReturnValueOnce` with a fallback). Each needs a flag variable.
- **`key: undefined` noise.** Exact `deepEqual` values now list keys
  that SDK users never see in JSON (`org_id`, `release`, `links`,
  `parent_span_id`). These tests break if the source stops writing
  such keys.
- **Small type frictions:**
  - `spyOn` on an overloaded function needs a cast.
  - A spy typed as an interface method has no `.calls`.
  - `stub(globalThis, 'performance', undefined)` needs a cast.
  - The `mockImport` mock list cannot be `as const`.
  - `spyOn` through a `@ts-expect-error` gives a spy of type `never`
    with no warning.
- **`setup()` at the top of every test** adds noise in large files
  (190 calls in `client.test.ts`).

## Changes a maintainer should look at

- `rewriteframes.test.ts:345` ("bails when unable to extract frames >
  no frames"): the name says the event is returned unchanged. The
  code returns a copy with `stacktrace: { frames: undefined }`. This
  is either a source defect or a wrong test name.
- `prepareEvent.test.ts:78,85,188` check a `filename3` key that no
  frame has, so they can never fail. It is probably a typo.
- `sentrySpan.test.ts:665` now asserts that `setAttribute` keeps the
  invalid value `[1, 'a']`, which is what the code does today.
- `src/utils/sdkMetadata.ts` `captureOptionsSetByUser<T extends
  Pick<CoreOptions, '_metadata'>>` is a weak-type error (TS2559) under
  TypeScript 7 for options with no `_metadata`. The test has a typed
  wrapper. The source is not changed.
- `client.test.ts`: the `dateTimestampInSeconds` spy is now
  `spyOn(Date, 'now')`, and the `uuid4` spy is now a spy on
  `crypto.randomUUID`.
- In a few places, a check is now partial (`assert.match`) where
  `objectContaining` was exact below the top level: the check-in
  tests, `feedback.test.ts`, `metrics/public-api.test.ts`. Where an
  absent key was the point of a test, the agents added an exact
  check.
- `aggregate-errors.test.ts`: one test has a new name, because two
  tests had the same name.

## Expected issues for the rest of the monorepo

The scale: about 1900 test files, 48 vite or vitest configs, 229
files with `vi.mock`, about 195 files that `vi.spyOn` an
`import * as` namespace, and 110 files with a jsdom or happy-dom
environment.

1. **Module namespace spies and `vi.mock`.** This will be most of the
   hand work. Plan for `mockImport` rewrites with shared modules
   passed as real instances. Packages that link `@sentry/core` load
   it again for each `mockImport` call unless the test passes it as
   a mock. Without `isMatch`, each "any call matched" check needs a
   decision.
2. **The `esmOnlyPlugin` in `vite/vite.config.ts`.** It removes
   `/*! rollup-include-cjs-only */` blocks before vitest runs. ubq has
   no plugins, so tests will run the CJS-only code. Eight source
   files have CJS-only blocks: `node/src/sdk/index.ts`,
   `node/src/integrations/modules.ts`, `nextjs/src/config/util.ts`,
   `nextjs/src/config/diagnosticsChannelInjection.ts`,
   `remix/src/v3/orchestrionLoader.ts`,
   `google-cloud-serverless/src/sdk.ts`,
   `server-runtime-injection/src/register.ts`, and
   `server-utils/src/orchestrion/bundler/resolve.ts`. More files
   (`browser`, `cloudflare`, `nuxt`) have only the ESM markers, which
   are comments and do no harm. This needs a source change or a ubq
   feature.
   `ubq convert` printed no note about it here, because the plugin is
   in the shared config.
3. **DOM tests.** 110 files use jsdom or happy-dom. Each needs a
   `dom()` helper with its own list of globals, and code that reads
   `window` at import time needs the DOM before the import. A shared
   DOM helper in a test-utils package would pay off. Expect DOM TODOs
   in files that do not need a DOM, too.
4. **`.tsx` tests (17 files).** Node cannot run JSX. These need Bun or
   Deno, or a change.
5. **Non-erasable syntax.** About 3 source files have an enum or a
   namespace, about 3 have parameter properties, and 2 have
   decorators (Angular). Each package owner must choose: change the
   source, the `transform` key, or Bun.
6. **Class field semantics.** Node type stripping defines a field
   with no initializer as `undefined` at construction time. The repo
   builds with `target: es2020`, where such a field does not exist
   until code assigns it. Tests now see different behavior from the
   shipped code for `'x' in obj`, `hasOwnProperty`, `Object.keys`,
   and subclass fields. This made `SyncPromise._value` fail.
7. **The type check is new for tests.** Expect hundreds of type
   errors per large package. `lib: ["DOM", "es2020"]` in the test
   tsconfigs makes `WeakRef`, `Object.hasOwn`, and `isWellFormed`
   type errors. Shared helpers with untyped spies cause errors at
   each call site, so fix the helpers first.
8. **Loose `toEqual`.** Expect many `undefined`-key, class, and
   null-prototype differences. Also watch for dotted
   `toHaveProperty` checks, which need a person to decide between a
   flat key and a path.
9. **Tests that import from `build/`** (15 files) fail the type check
   with no build.
10. **Other runners and setups.**
    - 6 configs use `setupFiles`, which become imports in each test
      file.
    - 2 packages use the Cloudflare workers pool.
    - dev-packages use Playwright and child-process scenarios.
    - Some packages' `test` scripts call other tools.
    - Each needs its own plan.
11. **CI.**
    - The workspace has `devEngines` Node 24.22.1, and ubq needs Node
      22.18 or later, so this is fine. Confirm the CI matrix has no
      older Node.
    - Cache `.ubq/counters` between jobs. The store here grew to
      374 MB, mostly from many runs.
    - The `minimumReleaseAge` policy will block new ubqtest releases
      for a day unless they are excluded.
12. **Parallel conversion work.** Several agents or people in one
    package share one `.ubq` store. `ubq failures` and the "other
    files" count then show other people's work. Use `CI=1 ubq <file>`
    output, or pass run numbers.
13. **Formatter.** The repo uses oxfmt. A hand run of prettier changes
    whole files.

## Open items

- Two test files keep local casts that worked around the
  mcp-server helper types (`oauthClient.test.ts`,
  `piiFiltering.test.ts`). I fixed the helper later, so the casts are
  probably no longer needed.
- The per-batch notes, with full detail and file:line examples, are
  in `/tmp/ubqdocs/notes-1.md` to `notes-8.md`. `/tmp` can be
  cleared, so copy them if you want to keep them.
