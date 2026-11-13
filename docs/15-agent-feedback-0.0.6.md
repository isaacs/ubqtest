# ubq 0.0.6 feedback: fourth conversion of a Cloudflare Workers project

Date: 2026-11-13. ubqtest 0.0.6. Node 26.5.0, macOS, wrangler 4, TypeScript 7.

## Result

The conversion is complete, and it was much smoother than with 0.0.5.

| | vitest | ubq 0.0.6 |
| --- | --- | --- |
| Boss (`test/`, 15 files) | 163 pass | 163 pass |
| Analyst (`analyst/test/`, 7 files) | 62 pass | 62 pass |
| Time for the full run | about 3.0 s | 2.9 s |
| TODO comments after `ubq convert` | | 17 (31 with 0.0.5) |
| Type errors after the TODOs | | 15 (17 with 0.0.5) |

All 225 tests passed on the first run after the TODOs. No test was removed, skipped, or made weaker, and no source file changed. `ubq doctor` reports 0 problems, and `tsc` agrees with ubq on the type errors. I changed one expected value to a wrong one, and the run failed with a clear report.

Everything below was tested, unless it says "not tested". The items are in order of how much they cost me, then preferences.

## What 0.0.6 fixed

Each of these was an item in my 0.0.5 report:

- `ubq doctor` and `ubq convert` read `vitest.config.ts`. The converter wrote the `ubq.workers` key with both projects and all seven test values, added `await migrate('DB')` to each Boss test file, and said that `test/setup.ts` can go.
- `beforeAll` at the top level of a file became a block, in all 9 files. No TODO.
- `toContainEqual` became `assert(list.some(item => isDeepEqual(item, x)))`. `isDeepEqual` reads well, and it removed my helper.
- The `afterEach(() => restore())` hint now says the correct thing: delete it and its assignments.
- `resolves.toBeDefined()` and `not.toHaveProperty()` convert with no type error.
- The type check uses `analyst/tsconfig.json` for the files under `analyst/`. The run reported 15 type errors, and `tsc` found the same 15.
- A run of one file reports only the type errors of that file. I tested this with a type error in an unrelated file in `test/`.
- `__UBQ_HOST` is gone from `env`.
- A wrangler config with `containers` loads.

## 1. The order of `doctor` and `convert` is not clear

Step 2 of the convert guide says: run `ubq doctor`, "and do each `FIX` line". Then step 3 runs `ubq convert`. doctor printed this:

```
FIX  this project has tests of a Cloudflare Worker [...] Add to package.json: "ubq": { "workers": [ ...800 characters of JSON on one line... ] }. This is from vitest.config.ts. "ubq convert" writes it.
```

So the FIX line says both "add it" and "convert writes it". A model that follows step 2 to the letter adds the key by hand, and then step 3 writes it again. I did not add it, and let the converter write it. Not tested: what the converter does when the key is already there.

Also, "What `ubq convert` changes" still says: "It does not change the name of a file, the source of the project, or `package.json`." The Workers section of the same guide says that it writes the `workers` key to `package.json`. One of the two is wrong.

Suggestions:

- When a vitest config is there, doctor says only: "`ubq convert` writes the `workers` key from vitest.config.ts. Run it in step 3." No JSON.
- If doctor must print the JSON, print it on several lines, so a person can read it.
- Correct the sentence about `package.json`.

## 2. Deletions that the converter could do

The converter now knows these patterns well enough to give the correct hint. It could make the change, and leave no TODO:

- `vi.restoreAllMocks()` in the middle of a test (2 places). The TODO says "Remove this call." That is all there is to do.
- `let restore = () => {}` + `afterEach(() => restore())` + each `restore = m.restore` (9 files, 37 assignments).

The restore pattern also has two parts that the hint does not mention:

- 3 calls of `restore()` and one of `m.restore()` in the middle of a test, where a test changes its fetch mock. The hint says to delete "each assignment to restore", but these are calls. They are safe to delete, because a second `spyOn` replaces the first, but a model must know that.
- The helper `mockFetch` returns `{ calls, restore: () => spy.mockRestore() }`, with the TODO "Remove this call." Removing it breaks the `m.restore` uses in the 9 files, so the order of the edits matters. If the converter does all of it in one pass, the order does not matter.

## 3. `?.includes` in 179 places

The converter changed each `expect(x).toContain(s)` to `assert(x?.includes(s))`. In most places `x` is a string that cannot be `undefined`:

```ts
const page = await (await get(f, `/batches/${b.id}`)).text()
assert(page?.includes('The 2 fixes work on top of each other.'))
```

I do not prefer this:

- `?.` tells the reader that `page` can be missing. It cannot. A reader then looks for the case where it is.
- It is in 179 places in 14 files, so it is the most common form in the converted tests.
- It did not help in the one place that needed help: `x.release_notes?.includes(...)` on a value of type `unknown` is still a type error.

Suggestion: use `x.includes(s)`, and let the type check report the places where `x` can be `undefined`. The new row in "Failures after the conversion" already tells the reader to add `!` or `?.` there. Or, if the converter can get types from TypeScript, add `?.` only where the type has `undefined` or `null`.

## 4. The test wrangler config of the Analyst is not needed, and nothing said so

The project had `analyst/wrangler.test.jsonc`, a copy of the Analyst config without `containers`. Its first line said why: "the Workers test plugin does not support [containers] yet." The converter copied it into the `workers` entry, which is the correct, safe choice.

I learned that ubq loads `containers` only because I tried the real config to check a statement in my own notes. Then I found the line in the guide. I changed the entry to `analyst/wrangler.jsonc`, removed the test copy, and all 62 tests still pass.

Suggestion: a note from `ubq convert` when a project of the vitest config uses a wrangler config whose name has `test` in it, or one that is the same as another config except for `containers`: "ubq can load `containers`. If this config exists only to remove them, use `analyst/wrangler.jsonc`." Or one sentence in the Workers part of the convert guide.

## 5. Type errors that are left

15 after the TODOs: 11 in `test/`, 4 in `analyst/test/`. The new row in "Failures after the conversion" covers all of them, and it gave the `assert.deepEqual<unknown>` form that I could find only in the types before. The kinds:

| Count | Form | Fix |
| --- | --- | --- |
| 4 | `runs[0]` in an expected array, with `noUncheckedIndexedAccess` | `runs[0]!` |
| 4 | `r.version_commit` is `unknown` (a D1 row) | `as string` |
| 2 | `string \| null` where the actual value is `string \| undefined` | `!` |
| 4 | `deepEqual(validate(x), x)`: the two types differ on purpose | `deepEqual<unknown>` |
| 1 | `x.release_notes?.includes(...)` on `unknown` | `(x.release_notes as string).includes(...)` |

I have nothing to add here. The strict types found loose tests, and the guide now explains the fixes.

## 6. Small items and preferences

- **Commit before convert.** Step 3 says "Commit before it, so that `git diff` shows the changes." An agent must not commit without the permission of the user, and `git diff` shows the changes against the last commit anyway, if the tree was clean. Suggest: "Make sure that `git status` is clean before it."
- **The helper-file note.** The converter still prints "1 of these files do not have a name that ubq runs" for `test/helpers.ts`, a helper with no tests. The note now says that a helper needs no change, so it is harmless, but it is noise on each run. The converter could check if the file calls `test()`.
- **"3 files with no known test tool".** The report does not name them. I assume they are `test/setup.ts`, `test/fake-git.ts`, and `analyst/test/fakes.ts`. A name would remove the guess.
- **`TEST_MIGRATIONS`.** The guide says the converter prints a note for a binding that is not a plain value. `TEST_MIGRATIONS: await readD1Migrations('./migrations')` got no note, and it is not in `vars`. That is the correct result, because `migrate('DB')` replaces it. But the guide could say that the converter knows this one, so a reader does not look for the missing note.
- **Import order.** The converter wrote `import { migrate, executionContext } from 'ubqtest/workers'` (not sorted), and in some files it put the `ubqtest/workers` import above the `ubqtest` import. Not important.
- **Long report lines.** Each TODO line of the converter report is 200 to 400 characters, and the hint text repeats for each place. In a terminal that is hard to scan. A short form, with the full hint once at the end for each kind, would be easier to read.

## For a less able model

The places where I used knowledge that the tool did not give me, in the order a model meets them:

1. Do not add the doctor JSON by hand before `ubq convert` (item 1).
2. Delete the `restore()` calls in the middle of tests, and edit the helper and its callers together (item 2).
3. Know that `analyst/wrangler.test.jsonc` can go (item 4). A model that does not know this still gets a working conversion, so this one is optional.

Everything else came from the TODO hints, the guide, and the run output. That is a large change from 0.0.5.
