# Agent feedback on ubqtest 0.0.14

An agent (Claude Code) moved the tests of a Cloudflare Workers project from vitest to ubqtest 0.0.14. It used `ubq doctor`, `ubq convert`, and the bundled guides.

## The project

- Two Workers, each with its own wrangler config: a main Worker with D1, and an "Analyst" Worker with R2, a Workflow, and a Durable Object with `containers`.
- 22 test files and 225 tests, on vitest 5 and `@cloudflare/vitest-plugin`.
- A `setupFiles` entry that only applied D1 migrations.
- A test copy of the Analyst wrangler config, without `containers`.
- A `mockFetch` helper that used `vi.spyOn(globalThis, 'fetch')` and returned a `restore` function. Most test files called it from `afterEach`.
- Node 26.5.0, macOS.

## Result

- 225 tests pass under `ubq`, the same count as vitest.
- `ubq check` and `ubq doctor` report no problems, and `tsc` passes.
- A full run takes about 3 seconds, the same as vitest.
- The converter changed 23 files and left 17 TODOs. After the TODOs, 15 type errors were left to fix by hand.
- The test copy of the Analyst wrangler config is gone. The real config, with `containers`, loads with no problem.

## Problems

### `doctor` passes a tsconfig that the guide's own examples fail on

The site says `"allowImportingTsExtensions": true` is required, and the guide's examples import `'../src/parse.ts'`. `doctor` reported `ok   tsconfig.json` without that setting. A test file that then imported `'./helpers.ts'` failed with:

```
TYPE test/zz-scratch.test.ts
  TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
```

Either `doctor` should check for the setting, or the docs should say that `.js` imports work without it and that the setting is required only for `.ts` imports.

### `doctor` exits 1 on a FIX that needs no action

Before `convert`, `doctor` printed this and exited 1:

```
FIX  this project has tests of a Cloudflare Worker (...). Do not add it by hand: "ubq convert" writes it to package.json, from vitest.config.ts.
doctor: 2 problems
```

The convert guide says: "A line that says that `ubq convert` does the work needs no action in this step." A line that needs no action should not be a `FIX`, and should not count as a problem. A different label (for example `NEXT` or `INFO`) would fit.

The summary also says "1 problems" when there is one problem.

### Hint [1] cleanup missed an indented `vi.restoreAllMocks()`

At the top level, the converter marked `afterEach(() => restore())` with hint [1]. In two tests in `batches.test.ts`, it kept this call and added hint [2]:

```ts
    // TODO(ubq): A spyOn spy goes back when its test ends. Remove this call, ...
    vi.restoreAllMocks()
```

`vi` was no longer imported, so the test failed at runtime with `ReferenceError: vi is not defined`. The converter can remove a `vi.restoreAllMocks()` that a `mockFetch`/`spyOn` call follows, or at least drop the call and leave the TODO. Either way, it should not leave a call to a name that is not imported.

### `vi.spyOn().mockImplementation()` kept its old indent

Input:

```ts
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const req = new Request(input, init)
      ...
    })
```

Output:

```ts
  const spy = spyOn(globalThis, 'fetch', async (input, init) => {
      const req = new Request(input, init)
      ...
    })
```

The body stays two spaces too deep, and the closing `})` does not line up with `spyOn`.

### The converter joins wrapped expressions onto one line

Multi-line `expect(...)` calls became single lines. Lines longer than 100 characters, before and after:

| File | Before | After |
|---|---|---|
| `test/release.test.ts` | 9 | 18 |
| `test/release-commits.test.ts` | 0 | 8 |
| `analyst/test/tools.test.ts` | 0 | 4 |
| `analyst/test/workflow.test.ts` | 1 | 4 |

For example, this:

```ts
    expect(
      parsePatch(`diff --git a/e b/e\nnew file mode 100644\nindex ${zero}..${empty}\n`),
    ).toMatchObject([{ path: 'e', kind: 'add', hunks: [] }])
```

became one line of about 150 characters. A project with no formatter keeps these long lines.

### A `toContain` that fails no longer shows the actual value

The converter changes `expect(text).toContain(x)` to `assert(text.includes(x))`. This project has 188 of them, most on HTML pages. When one fails, ubq prints:

```
FAIL test/zz-scratch.test.ts > contains
  expected a truthy value, got false
  at test/zz-scratch.test.ts:5:3
  > assert(page.includes('goodbye'))
```

vitest printed the string it searched. Without it, the next step is always to add a `console.log` and run again. Some options:

- An `assert.includes(haystack, needle)` that prints the haystack (cut down to a window) on failure.
- When the actual value is a string literal type or `string`, convert to `assert.match(text, /escaped/)`, which already prints the actual value.
- Have `assert()` print the values of a `.includes()` call that it can see on the source line.

### `test:update` is the same command as `test`

The guide says to set `"test": "ubq"` and `"test:update": "ubq"`. The two scripts look the same, and the update behavior depends on the script name. That was a surprise. `"test:update": "ubq --update"` would say what it does. A project with no `assert.snapshot` calls does not need the script, and the guide could say so.

### Small things

- `ubq --version` prints `ubq: unknown option: --version`. Other tools accept `--version` (or `-v`), and it helps in bug reports.
- `ubq convert --dry` prints `converted <file> ...` for each file, but it changed no file. "would convert" fits better.
- The site's convert page lists `bun:test` in its intro but has no section for it. The bundled `CONVERT.md` (from `ubq guide convert`) has it. In general, the bundled guides were more complete and more useful than the site.
- With vitest, the ANALYST service binding was a stub that answered 500. Under ubq the stand-in answers 503. No test depended on the code, but a project whose tests check the status would see a change. The convert guide could mention it next to the `serviceBindings` notes.

## What worked well

- The TODO hints were specific and correct. Each one told the agent what to do, and the full text appears once at the end of the report.
- The `workers` key came over from `vitest.config.ts` with no hand work, including `vars`. The converter replaced the D1 migration setup file with `await migrate('DB')` in each file and said that the setup file could go.
- The note about `analyst/wrangler.test.jsonc` was right: the real config with `containers` works, so the copy is gone.
- Type checking on each run found 15 places where `expect()` had accepted values of any type. Each fix was one of the forms the guide lists (`!`, `?.`, or `deepEqual<unknown>`).
- The failure output is clear. For a deep-equal failure it gives the path (`.b[2]`), the actual and expected values, the source line, and a rerun command.
- Coverage works inside workerd. `ubq uncovered` listed 404 spans in the Workers source.
- `ubq check` is a good final step after a conversion.
- `ubq <file>:<line>` and `--repeat` worked as documented.
