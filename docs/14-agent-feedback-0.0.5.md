# ubq 0.0.5 feedback: third conversion of a Cloudflare Workers project

Date: 2026-11-13. ubqtest 0.0.5. Node 26.5.0, macOS, wrangler 4, TypeScript 7.

## Result

The conversion is complete. Both Workers run under ubq, in workerd.

| | vitest | ubq 0.0.5 |
| --- | --- | --- |
| Boss (`test/`, 15 files) | 163 pass | 163 pass |
| Analyst (`analyst/test/`, 7 files) | 62 pass | 62 pass |
| Time for the full run | about 3.0 s | 3.0 s |

No test was removed, skipped, or made weaker. No source file changed. `ubq doctor` reports 0 problems. Three runs in a row passed, each with a different file order. I changed one expected value to a wrong one, and the run failed with a clear report.

Nothing stopped the work this time. The items below are the places where a less able model could go wrong, or where the tool could do work that I did by hand. Everything was tested, unless it says "not tested".

## What 0.0.5 fixed

Each of these was an item in my 0.0.4 report, and each works now:

- A named import from a CommonJS package in a dependency (`@anthropic-ai/sdk` and `standardwebhooks`). The 7 Analyst files load.
- A service binding to a second Worker gets a stand-in. workerd starts with the production config.
- A test does not get `.dev.vars`. I checked the keys and the lengths of the values in `env` for both Workers: only the test values are there.
- The `vars` key of a `workers` entry. With it and the stand-in, the second wrangler config for the Boss was not necessary.
- The guide and the convert guide now say that only the test file can do I/O at its top level, and give `await migrate('DB')` in each test file as the answer.
- `not.toMatch(/re/)` converts. No file was skipped.
- Each `expect.any`, `expect.arrayContaining`, and `expect.stringContaining` got a TODO or a conversion. `stringContaining` in an `assert.match` pattern became a RegExp.
- `toContain` on a value that can be `undefined` became `x?.includes(s)`.
- `assert.throws(fn, x)` with a value that can be a string got a TODO.

## The hand work that was left

After `npx ubq convert test analyst/test`, these were the steps. The count of each is the number of places.

| Step | Places | Could the tool do it? |
| --- | --- | --- |
| The `ubq` key in `package.json` | 1 | Partly: item 1 |
| `await migrate('DB')` in each test file, and removal of the setup file | 13 + 2 | Yes: item 1 |
| `beforeAll` at the top level of a file | 9 | Yes, in most cases: item 2 |
| `beforeAll` in a `describe` | 2, and `await setup()` in 7 tests | No |
| `afterEach(() => restore())`, `restore = m.restore`, `restore()` | 9 + 37 + 3 | Partly: item 3 |
| `vi.restoreAllMocks()` in the middle of a test | 2 | Yes: item 3 |
| `toContainEqual` | 5 | Partly: item 5 |
| `expect.any`, `expect.arrayContaining` | 2 | No |
| `assert.throws` with a string or a RegExp | 1 | No |
| Type errors | 17 | Partly: item 4 |
| `tsconfig.json`, old packages, old config | 3 files | Partly: item 6 |

The converter left 31 TODO comments. The earlier counts were 39 (0.0.3) and 28 (0.0.4, with two files skipped).

## 1. The converter does not read the vitest config

Everything that the vitest config said, I moved by hand:

- **`setupFiles`.** `test/setup.ts` had two lines: the import of `applyD1Migrations` and `env`, and the call. The converter listed it among "3 files with no known test tool" and did not change it. It did not add `await migrate('DB')` to a test file. The convert guide has the rule, but a model that works only from the TODO list will not find it. I added the line before the first run, so I did not see what the failure looks like without it.
- **`miniflare.bindings`.** Seven test values. I copied them into `vars`.
- **`projects`.** Two Workers, each with a wrangler config and an `include`. `ubq doctor` and the note of `ubq convert` both print a config with one entry, for `wrangler.jsonc` and `test/**/*.test.ts`. That entry is wrong for the 7 Analyst files, which need `analyst/wrangler.test.jsonc`.

Suggestions:

- `ubq convert` reads `vitest.config.*` when it has `cloudflareTest` (or the old `defineWorkersConfig`), and prints the complete `ubq` key: one entry for each project, with `config`, `include`, and `vars` from `miniflare.bindings`. A value that is not a literal (here: `TEST_MIGRATIONS: await readD1Migrations(...)`) gets a note.
- For a setup file whose only work is `applyD1Migrations`: add `await migrate('<binding>')` after the imports of each test file of that project, and say that the setup file can go.
- If the config is not read: put one line in the report output of `ubq convert`, such as "this project has a vitest setup file (test/setup.ts). See 'A Cloudflare Worker' in ubq guide convert."
- `ubq doctor` could find a second wrangler config, and print one entry for each.

## 2. `beforeAll` at the top level of a file

All 9 had the same form, and I changed all 9 with one regular expression: `beforeAll(async () => {` became `{`, and `})` became `}`. The block keeps the local names of the callback out of the file scope, and top-level `await` works in a block.

```ts
// before
beforeAll(async () => {
  await insertRepository(env.DB, { id: 1020, full_name: repo, installation_id: 520 }, 'system')
})

// after
{
  await insertRepository(env.DB, { id: 1020, full_name: repo, installation_id: 520 }, 'system')
}
```

All 9 worked at the same place in the file. The hint warns about names that the file declares below the hook, and that warning is correct. The converter could do the change itself when each name that the callback uses is declared above it, and leave the TODO for the other cases.

One thing to add to the hint: in a Workers test file, the block must come after `await migrate(...)`.

## 3. Restore functions

- `vi.restoreAllMocks()` in the middle of a test still gets a TODO that says "Remove this call." The converter can remove it.
- The project's helper returns `{ calls, restore: () => spy.mockRestore() }`, and 9 files have this:

  ```ts
  let restore = () => {}
  afterEach(() => restore())
  // in each test:
  restore = m.restore
  ```

  The TODO on the `afterEach` gives the general hook hint ("Make a setup function and call it in each test"). That hint does not fit: the correct change is to delete all three kinds of line. A model that follows the hint will write a setup function that nothing needs. When the body of an `afterEach` is one call of a variable that is assigned from a `.restore` or `.mockRestore` value, the hint could say: "If this only restores spies, delete it, and delete the assignments. A `spyOn` spy goes back when its test ends."

## 4. Type errors

17 type errors were left after all TODOs were done: 12 in `test/`, 5 in `analyst/test/`. The count was 34 with 0.0.4, and the `?.includes` change removed most of the difference.

| Count | Form | Fix that I used |
| --- | --- | --- |
| 4 | `assert.deepEqual(rows, [[0, runs[0], 'waiting']])`: `runs[0]` is `string \| undefined` | `runs[0]!` |
| 4 | `assert.equal(a, r.version_commit)`: the right side is `unknown` | `as string` |
| 2 | `assert.match(x, { parent: a.fix_commit })`: `string \| null` | `!` |
| 4 | `assert.deepEqual(validate(input), input)`: `input` has `string` where the result has a union of literals | `assert.deepEqual<unknown>(a, b)` |
| 1 | `x.release_notes?.includes(s)`: the value is `unknown` | `(x.release_notes as string).includes(s)` |
| 1 | `Reflect.has(x.thinking, 'k')` from `not.toHaveProperty('k')`: `x.thinking` can be `undefined` | `as object` |
| 1 | `await assert.notEqual(await p, undefined)` from `await expect(p).resolves.toBeDefined()` | `assert(await p)` |

Notes:

- 14 of the 17 come from `NoInfer<T>` on the expected value. It finds real loose tests, so I would keep it. But the convert guide still has no row for it in "Failures after the conversion". The row should give the two fixes: make the expected value exact (`!`, `as`), or write `assert.deepEqual<unknown>(a, b)` when the two types differ on purpose. The second one is not in any doc. I found it in `types/assert.d.ts`.
- `resolves.toBeDefined()`: the converted line has an `await` before `assert.notEqual`, which returns no promise. `assert.notEqual(await p, undefined)` is the correct form, and it would still have the type error when the type of `p` has no `undefined`. For that case `assert((await p) !== undefined)` has no type error.
- `not.toHaveProperty('k')`: `assert(!(x && 'k' in x))` or a cast would not fail the type check. `Reflect.has` needs an `object`.

## 5. `toContainEqual`

The hint is now: "find the element, then compare it: `const found = list.find(x => x.id === id); assert.deepEqual(found, expected)`". The values here are objects with no key to find them by: `{ contents: 'write' }` in a list of permission sets. I wrote a helper that compares the sorted entries as JSON.

ubq still has no way to get "these two values are deeply equal" as a boolean. An export such as `isDeepEqual(a, b)` would make this one line: `assert(list.some(x => isDeepEqual(x, expected)))`. The converter could then do the change itself. The same function would cover `expect.arrayContaining` with objects.

## 6. The type check covers only the root `tsconfig.json`

Still true. The first full run ended with `225 passed, 12 type errors`. All 12 were in `test/`. `analyst/test/` had 5 more, and ubq did not report them: `analyst/` has its own `tsconfig.json`. I saw them only because the project has a `typecheck` script that runs `tsc -p analyst`.

A model that trusts the last line of `ubq` would report a clean conversion with 5 type errors in it. Suggestion: check each test file with the nearest `tsconfig.json` above it, or add a `tsconfig` key to a `workers` entry.

Not tested this time: if a run of one file still prints the type errors of all files.

## 7. Small items

- **`__UBQ_HOST` in `env`.** `Object.keys(env)` has a `__UBQ_HOST` binding. The project's helper does `{ ...env, GITHUB_APP_PRIVATE_KEY }`, so the key travels into the app. Nothing failed, but a test that lists or compares the bindings would see it. A non-enumerable property, or a note in the guide, would do.
- **Containers.** With the production config of the Analyst, which has `containers`, each file fails with "Build ID should be set when a Container image requires preparation". The project already had a test config without `containers`, for the vitest plugin, so nothing changed for it. The guide could list `containers` as not supported, and the error could say so.
- **The stand-in answers 503.** The vitest config gave a stand-in that answered 500. No test depended on the number. The guide says 503, which was enough.
- **Old packages.** The clean-up step of the convert guide lists the config files to remove. It could also list the `types` entry of `tsconfig.json` (`@cloudflare/vitest-plugin/types`). I removed it in the same step as the package, so I did not test what `tsc` says when it stays.
- **A test file that git restores.** I put one file back with `git checkout` by mistake, and converted it again with `ubq convert <file>`. That worked with no problem, and it is a good property: the converter is safe to run on one file at any time.

## For a less able model

These are the places where I used knowledge that the output of the tool did not give me. I list them in the order in which a model would meet them:

1. The `ubq` key needs two entries and seven `vars`. The tool prints one entry and no `vars` (item 1).
2. Each test file needs `await migrate('DB')`. No TODO says so (item 1).
3. The `afterEach(() => restore())` hint points to a setup function. The correct change is to delete lines (item 3).
4. The last line of `ubq` said 12 type errors when there were 17 (item 6).
5. `assert.deepEqual<unknown>` is in no doc (item 4).

Items 1 and 2 of this list are the largest. With the vitest config read by the converter, the first run after `ubq convert` would have loaded every file.
