# ubq 0.0.4 feedback: second conversion of a Cloudflare Workers project

Date: 2026-11-13. ubqtest 0.0.4. Node 26.5.0, macOS, wrangler 4, TypeScript 7.

## Result

Partial. One of the two Workers converts completely. The other cannot load.

| | vitest | ubq 0.0.4 |
| --- | --- | --- |
| Boss (`test/`, 15 files) | 163 pass | 163 pass, in workerd |
| Analyst (`analyst/test/`, 7 files) | 62 pass | 0 run: no file loads |
| Time for the full run | about 3.0 s | 2.5 s (with the 7 load errors) |

The Analyst is blocked by item 1 below, and I found no workaround in test code or config. Because `npm test` must pass for both Workers, I put the project back on vitest. The whole conversion is saved as a patch, so it can be applied again when item 1 is fixed.

Everything in this report was tested, unless it says "not tested".

## What 0.0.4 fixed

All of these were problems in my 0.0.3 report, and all work now:

- Test files run in workerd with real D1 and R2 bindings. `env` from `cloudflare:workers`, `executionContext()`, `ctx.settled()`, `scheduledController()`, and `migrate('DB')` all worked on the first try.
- `ubq doctor` finds the `cloudflare:` imports and prints the `workers` config to add.
- `ubq convert` rewrites the `cloudflare:test` names.
- The converter rewrites `vi.spyOn(...).mockImplementation(impl)` and `mockResolvedValue`, removes `afterEach(() => vi.restoreAllMocks())`, and converts `toBeCloseTo` and `not.toHaveProperty`.
- The hook hints now differ by case: top-level code for a `beforeAll` of the file, and the `ready ??=` function for a `beforeAll` in a `describe`. Both hints were correct, and both forms worked.
- The guide says what a second `spyOn` on one key does.
- TODO comments went from 39 to 28 for the same files.

## 1. A named import from a CommonJS package, in a dependency (blocker)

All 7 Analyst test files fail with this:

```
ERROR analyst/test/workflow.test.ts
  the test file did not load: The requested module 'standardwebhooks' does not provide an export named 'Webhook'
```

The import is not in the project. The chain is:

- `analyst/src/workflow.ts`: `import Anthropic from '@anthropic-ai/sdk'`
- `node_modules/@anthropic-ai/sdk/resources/beta/webhooks.mjs`: `import { Webhook } from 'standardwebhooks'`
- `standardwebhooks` is CommonJS (`"type": "commonjs"`, `exports.Webhook = Webhook`).

The guide lists "a named import from a CommonJS package" as not available in a Workers test file. For the project's own code that is a fair limit, because I can change the import. Here I cannot: the import is in a dependency, and the main entry of the SDK always loads that file. Node, wrangler, and the vitest plugin all accept this import. So the limit stops any Worker that uses `@anthropic-ai/sdk`, and probably many other packages with ESM that imports CommonJS.

Things I tried:

- `"alias": { "standardwebhooks": "./test/standardwebhooks.ts" }` in the wrangler config, with a small ESM file that exports the names again. ubq ignores `alias`. The error did not change.
- I did not change the source, and I did not use an npm `overrides` entry: both would change production to get a test to load.

Suggestions, in my order of preference:

1. Give a CommonJS module its named exports. Node finds them with `cjs-module-lexer`. Or bundle dependencies with esbuild, as wrangler does, so the tests load the same module form that production does.
2. Honor the `alias` key of the wrangler config. It is useful in any case, and it would have been a workaround here.
3. Make the error say what to do. Today it reads as a defect in the dependency.

## 2. A service binding to a second Worker stops workerd, and the error does not say why

The Boss config has this:

```jsonc
"services": [
  { "binding": "ANALYST", "service": "ghsa-analyst", "entrypoint": "Analyst" }
]
```

With it, each test file that imports `cloudflare:workers` fails:

```
ERROR test/probe/env.test.ts
  the test file did not load: The Workers runtime failed to start. There was likely a problem with the workerd binary or your configuration.
```

The message names no binding and no cause. I found the cause by removing one config section at a time. Two details made that slower:

- A test file with no `cloudflare:` import passes with the same config. So my first bisection, with a trivial test, showed that every section was fine.
- workerd prints the real reason on stderr, but ubq does not show it. I found no flag or environment variable that shows it.

The vitest plugin has `miniflare.serviceBindings` for this: the project gave a function that returns a 500 response.

Suggestions:

- Show the stderr of workerd in the `ERROR` block when the runtime does not start.
- For a service binding whose target is not in the `workers` list, bind a stub that fails when called, and do not fail at start. Or let the `workers` entry replace a binding, as in item 3.
- The guide could say what happens to `services`, `workflows`, and Durable Object bindings to other scripts. Today it lists only D1, R2, KV, Durable Objects, and vars.

Workaround used: a second wrangler config for tests, without `services`.

## 3. `.dev.vars` goes into the test env, and no setting replaces a var

I checked the keys and the lengths of the values in `env`, not the values. With `"config": "wrangler.jsonc"`, the test `env` had `GITHUB_APP_PRIVATE_KEY` with 1705 characters and `GITHUB_CLIENT_SECRET` with 40 characters. Those are the real secrets from `.dev.vars`, which is next to the config.

So with the config that `ubq doctor` suggests, the tests run with a real GitHub App private key and a real OAuth secret. These tests replace `fetch`, but one test that does not would send real credentials to the real API. The vitest config had a comment for exactly this: "Test values. They replace anything in .dev.vars."

The same is true for the Analyst: `analyst/wrangler.test.jsonc` is next to `analyst/.dev.vars`, which holds the Anthropic key. (The vitest plugin does the same there, so that is not new.)

The convert guide says the values of `miniflare.bindings` "must come from the wrangler config, or from the test file". Neither works well here:

- `vars` in the wrangler config lose to `.dev.vars`, and the main config is the production config.
- "From the test file" means each test builds its own env object. That works only where the test passes `env` by hand. Code that reads `env` from `cloudflare:workers` still gets the real values.

Workaround used: `test/wrangler.jsonc`, a copy of the config in a folder with no `.dev.vars`, with `main` and `migrations_dir` as `../` paths, test values in `vars`, and no `services`. It works, but it is a second copy of each binding, and it will drift from the real config.

Suggestions:

- Do not read `.dev.vars` in a test run, or read only `.dev.vars.test`. A test should not get secrets by default.
- Add `vars`, or a more general `bindings`, to a `workers` entry: `{ "config": "wrangler.jsonc", "include": [...], "vars": { "GITHUB_APP_ID": "12345" } }`. With that and the stub of item 2, this project would need no second config.
- At the least, say in the guide that `.dev.vars` is read.

## 4. A binding call at the top level of an imported module fails

This works, as the guide shows:

```ts
// test/a.test.ts
import { migrate } from 'ubqtest/workers'
await migrate('DB')
```

This fails:

```ts
// test/helpers.ts
import { migrate } from 'ubqtest/workers'
await migrate('DB')

// test/a.test.ts
import { ORIGIN } from './helpers.ts'
```

```
ERROR test/batches.test.ts
  the test file did not load: Disallowed operation called within global scope. Asynchronous I/O (ex: fetch() or connect()), setting a timeout, and generating random values are not allowed within global scope. To fix this error, perform this operation within a handler.
  at test/helpers.ts:10:7
  > await migrate('DB')
```

A direct D1 call fails the same way: `export const n = await env.DB.prepare('select 1').first()` in a helper. A top-level `await crypto.subtle.digest(...)` in a helper works, so top-level `await` itself is fine. The failure is for I/O.

This is the opposite of the convert guide, which says: "A setup file of the vitest config (`setupFiles`) becomes a module that each test file imports." A setup file for a Worker is nearly always a D1 migration, so the advice leads straight to this error. The error text is from workerd, and it does not help: the code is not in the global scope of the Worker as the author sees it.

Workaround used: `await migrate('DB')` in each of the 13 test files that use the database.

Suggestions:

- Fix it, if the test file and its imports can load in the same request context. That is what a user expects.
- If not, say it in the guide and in the convert guide, and change the `setupFiles` advice to "export a function, and await it at the top of each test file".
- Add a note to this error when the place is not the test file.

Not tested: a helper that the test file loads with `await import()`.

## 5. The converter

### 5a. One statement stops the conversion of a whole file

```
not converted test/auth.test.ts: two changes at one place (offset 3341)
not converted test/comments.test.ts: two changes at one place (offset 6528)
```

Both offsets are at `expect(x).not.toMatch(/re/)`. I changed each to `expect(/re/.test(x)).toBe(false)` by hand, and then both files converted (56 and 57 changes).

- `not.toMatch(/re/)` should become `assert(!/re/.test(x))`.
- A statement that the converter cannot do should get a TODO, and the other statements of the file should convert. A byte offset is hard to use: a line number would be better.
- The summary line said "21 files changed" and did not count the two files it skipped. I saw them only because I read the full output.

### 5b. `expect.*` matchers stay in the code, with no TODO

Three places, in three files:

```ts
assert.deepEqual(await res.json(), { count: expect.any(Number) })
assert.deepEqual(names, expect.arrayContaining(['verify', 'verify 2']))
assert.match(last.at(-1), { role: 'user', content: expect.stringContaining('submit_result') })
```

The converter changed the outer call and removed `expect` from the import, so each one fails at run time with `ReferenceError: expect is not defined`. The convert guide covers these matchers in text, but the converter gives no TODO. `grep TODO(ubq)` is the documented way to find the work that is left, so these are easy to miss.

`expect.stringContaining('x')` in an `assert.match` pattern could convert to `/x/` (with the text escaped). The other two need a TODO.

### 5c. Converted code that is correct at run time but fails the type check

After the conversion, and with all TODOs done, the type checker reported 34 errors in 7 files. Under vitest these files had none. The kinds:

| Count | Converted form | Cause |
| --- | --- | --- |
| 14 | `assert(x[k].includes(s))` from `expect(x[k]).toContain(s)` | `x[k]` can be `undefined` or `null`. `expect()` took any value. |
| 13 | `assert.deepEqual(actual, expected)`, `assert.equal(a, b)` | `expected` is `NoInfer<T>`. A wider type on the right (`string` for a union, `unknown`, `string \| undefined`) is an error. |
| 1 | `assert.match(x, { k: v })` | the same, in a pattern |
| 1 | `Reflect.has(x.k, 'name')` from `expect(x.k).not.toHaveProperty('name')` | `x.k` can be `undefined` |
| 1 | `assert.throws(fn, message)` with `message: string \| RegExp` | a string is not permitted, and it throws a `TypeError` at run time too |
| 1 | `await assert.notEqual(await p, undefined)` from `await expect(p).resolves.toBeDefined()` | the type of `undefined`, and an `await` with no purpose |
| 3 | the `expect.*` leftovers of 5b | |

Strict types for assertions are a good choice, and some of these found loose tests. But a conversion of 6,000 lines that ends with 34 type errors, in a tool that fails the run on a type error, is a lot of hand work that the guide does not mention.

Suggestions:

- For `toContain` on a value that can be `undefined`, write `assert(x[k]?.includes(s))`. It has the same result and no type error.
- Add a row to "Failures after the conversion" for a `TYPE` block in a converted assertion, with the two fixes: `!` or `?.` on the actual value, and `assert.deepEqual<unknown>(a, b)` when the comparison of two different types is intended. I found the second one only by reading `types/assert.d.ts`.
- For `assert.throws(fn, x)` where `x` is not a literal, add a TODO: vitest accepts a string there.

### 5d. Restore calls

The converter left `restore = m.restore` (37 lines in 9 files) and three calls of `restore()` in the middle of a test, with one TODO at the place that defined `restore`. That is reasonable, because `restore` is the project's own name. A sentence in the report output would help: "the helper `mockFetch` returned a restore function. Remove its uses."

## 6. Type errors of other files in a run of a selection

Still true in 0.0.4. A run of one probe file ended with `26 type errors`, all from other files. While I fixed one file at a time, the last line of each run was `fail`, also when the selected file passed. I had to filter the output with `grep` to see the result.

Also still true: only the root `tsconfig.json` is checked. The errors in `analyst/test/` showed only with `tsc -p analyst`, so `ubq` said the type check was clean when 8 errors were left.

Suggestion: the `workers` entries already list one config for each Worker. A `tsconfig` key there, or a search for the nearest `tsconfig.json` above each test file, would cover the second project.

## 7. Small items

- `ubq show '<test id>'` gave "no stored result" for a test whose file did not load. A pointer to the `ERROR` of the file would be better.
- I found no way to see the `console.log` output of a test that passes, other than `ubq show`. To inspect a value, I made a test that fails with the value in its message. Not tested further.

## What the conversion needed, for the Worker that passed

For the record, these are all the steps for the Boss (15 test files, 163 tests):

1. `npx ubq convert test analyst/test`, with the hand change of 5a for two files.
2. The `workers` key in `package.json`, with two entries.
3. `test/wrangler.jsonc`, for items 2 and 3.
4. `await migrate('DB')` in 13 test files, for item 4. Removed `test/setup.ts` and `test/env.d.ts`.
5. Hooks: 9 top-level `beforeAll` became blocks at the top level. 2 `beforeAll` in a `describe` became `ready ??=` functions, with `await setup()` in 7 tests.
6. Removed the restore lines of 5d, and made `mockFetch` return only `{ calls }`.
7. 5 `toContainEqual` assertions: a helper of 4 lines that compares sorted entries.
8. The 3 `expect.*` leftovers of 5b, and the 34 type errors of 5c.
9. `tsconfig.json`: removed the vitest plugin types, added `erasableSyntaxOnly`. Removed `vitest.config.ts`, `vitest`, and `@cloudflare/vitest-plugin`.

No test was removed, skipped, or made weaker, and no source file changed. `ubq doctor` reported 0 problems at the end.

## Priority

1. Item 1 (CommonJS named imports in dependencies). It is the only thing that stops this project.
2. Item 3 (`.dev.vars`). Real secrets in a test env by default is a safety problem, and the fix also removes the need for a second config.
3. Item 2 (service bindings, and the stderr of workerd).
4. Item 4 (I/O at the top level of a helper), or a correction of the `setupFiles` advice.
5. Items 5a and 5b (the converter must not skip a file or leave `expect` with no TODO).
