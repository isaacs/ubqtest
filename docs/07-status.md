# Status

What exists, by step of the build order in `04-architecture.md`,
section 13. Update this file when a step ends.

## Commands

| Command | Does |
| --- | --- |
| `npm test` | runs the tool's own tests (on `node:test` until step 3) |
| `npm run typecheck` | must print nothing |
| `npm run build` | makes `dist/index.js`, one bundled file |
| `npm run bench` | builds, then times ubq and other tools. `-- --check` fails if a ubq row is over its budget. `-- --only ubq` runs only ubq rows. |

## Step 0: done (2026-11-11)

- `package.json`, `tsconfig.json`, `.gitignore`.
- `docs/05-api.md`, `docs/06-events.md`, `src/events.ts`.
- `experiments/suite/bench.mjs`.
- `esbuild` is a development dependency for the bundle. The
  package still has no dependencies at install time.

## Step 1: done (2026-11-11)

Source files:

| File | Contents |
| --- | --- |
| `src/index.ts` | public exports, starts the plain program role |
| `src/test.ts` | `test`, `describe`, the loop that runs tests one at a time |
| `src/assert.ts` | the assertion functions |
| `src/format.ts` | values as text, differences with paths |
| `src/stack.ts` | stack traces as user code locations |
| `src/state.ts` | the `AsyncLocalStorage` for the current test |
| `src/emit.ts` | publishes events on `diagnostics_channel` |
| `src/plain.ts` | runner role for a plain program |
| `src/sink-text.ts` | compact text sink |
| `src/hint.ts` | errors for wrong guesses |
| `src/project.ts` | project root, relative paths |

Checks (`test/plain.ts`, `test/types.ts`):

- The fixtures in `test/fixtures/` give the same exit code and
  summary on Node, Deno, and Bun. Node and Deno give the same
  text, byte for byte (`*.out` files).
- Zero assertions fails. So do: `assert.rejects` with no `await`,
  an assertion that a `catch` took, an assertion after the end, an
  error in a callback, a timeout, a duplicate name, and a file
  with no tests (exit code 2).
- Each wrong guess in `test/fixtures/types-bad.ts` is a compile
  error that names the fix.
- Speed, with the bundle and with no coverage yet: 57 ms for one
  TypeScript file as a plain program (budget 65), 35 ms with the
  compile cache (budget 40).

Not in step 1: `spy`, `spyOn`, `mockImport`, `testdir`, `env`,
`cleanup` (step 7), console capture (step 4), coverage (step 2).

Known limits:

- The stack parser reads POSIX paths only. Windows needs work.
- Bun reports different columns for some frames, and gives no
  location for an assertion in a timer callback.
- A sync test cannot time out in its own process. The runner
  handles that case in step 4.
- A timer that a timed-out test leaves behind keeps the process
  alive until it fires.
- Text output has no size limit yet.

## Step 2: done (2026-11-11)

Source files:

| File | Contents |
| --- | --- |
| `src/coverage.ts` | V8 collector: start, snapshot, `flatten` |
| `src/preload.ts` | `node --import ubqtest/preload`: starts coverage before user modules load |
| `src/store.ts` | `.ubq/runs.db`: schema, writer sink, retention |
| `src/query.ts` | `uncovered`, `covers`, failures, last result |
| `src/cli.ts` | the `ubq` command: `failures`, `show`, `uncovered`, `covers`, `sql` |

Run the CLI from source with `node src/cli.ts <command>`.

Checks (`test/coverage.ts`, fixture project `test/fixtures/cov/`):

- `uncovered` lists a branch not taken, an inner function that
  was not called, and a function that never ran.
- `covers` names the tests that ran a line, and the test file for
  code that ran at load.
- A new run of a test replaces its coverage rows.
- Command errors exit with code 4.
- Speed with coverage and the store on: 66 ms plain (budget 70),
  43 ms with the compile cache (budget 45). The budgets moved up
  by 5 ms; `04-architecture.md`, section 12, has the reason.

What was learned:

- V8 lists a function that never ran only if coverage started
  before the function's module ran its top-level code. The library
  now starts coverage in the same tick as its own load (no
  `await`), so a test file that imports `ubqtest` before its source
  modules gets full data.
- A plain run cannot know the import order, so it records its
  coverage as `partial`. `ubq uncovered` prints a note for such
  files. A run with `--import ubqtest/preload` records `full`.
- On Deno the collector works. On Bun there is no collector yet
  (`none`), as planned for step 5.
- The fixtures are their own project (`test/fixtures/package.json`)
  so that test runs do not write to the store of this repository.
  `test/setup.ts` links `ubqtest` into the fixture `node_modules`.

Known limits:

- `ubq uncovered` reads the source file as it is now. If the file
  changed after the run, lines can be wrong. The store does not
  hold content hashes yet (step 6 needs them for `--changed`).
- The Deno inspector answers later than Node's, so coverage start
  on Deno can be late. Not measured yet (step 8).
