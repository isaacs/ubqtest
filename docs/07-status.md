# Status

What exists, as a short log by step of the build order in
`04-architecture.md`, section 13. Add a short entry when a step
ends. The details of older steps are in the git history.

## Commands

| Command | Does |
| --- | --- |
| `npm test` | runs the tool's own tests with ubq itself: `node src/cli.ts` |
| `npm run typecheck` | must print nothing |
| `npm run build` | makes the package in `dist/` (D32): bundled JavaScript, type declarations, `package.json` |
| `npm run docs` | builds, then makes `docs/api.md` from the type declarations (`scripts/api-docs.ts`). A test fails if the file is not current. |
| `npm run bench` | builds, then times ubq and other tools. `-- --check` fails if a ubq row is over its budget. `-- --only ubq` runs only ubq rows. |
| `npm run bench:tools` | times ubq, vitest, ava, tape, and mocha on the same 20 test files, in a Docker container with 2 CPUs and 2 GB (`bench/README.md`). Options after `--`: `--cpus 4 --memory 4g`, `--runs 3`, `--only vitest`, `--json`. |

## Checks before each commit

```
npm run lint            # fixes lint and format problems; must exit 0
npx tsc                 # must print nothing
node src/cli.ts         # the tool runs its own tests: all pass
npm run bench -- --only ubq --check   # speed guards (builds first)
```

The suite needs `bun` and `deno` on the path for all tests. A test
skips itself, with a reason, if its runtime is not installed.

The tests of this repository pass on Node 22.18 and later (D104). If `node -v` shows an older version, look
for a newer one on the machine (a cloud session has
`/opt/node24/bin`), and put it first on the path.

The budgets of the benchmark are for the machine of the first
measurements. On a different machine, or late in a long session,
rows can be over budget. Then run the benchmark on the commit
before the change and on the change, and compare the two.

If a test fails, `node src/cli.ts failures` prints the failures of
the last run again, and `node src/cli.ts failures <run>` prints an
older run.

## Lessons for work on this repository

- A command that can hang must run under `timeout`.
- A test must not fail because a machine is slow. Three rules:
  - No time limit below the default of the project (120 s) for a
    test that starts a process. A limit is only for a test that
    never ends.
  - A test that waits for a message waits for the content that it
    needs, not for the next message of a kind. A second message
    with old content can come first.
  - A test that waits for a child process fails at once if the
    child ended, with the output of the child in the error.
- The formatter can split a line, and move a `// ubq: not
  measured:` comment away from the code that it marks. After
  `npm run lint`, compare `ubq uncovered` with its count before.
  Put the comment above the line that has the range, or at the end
  of that line.
- A test process that starts child processes must not pass
  `UBQ_*` variables on. The library removes them when it loads.
- Two test files must not share one fixture store, and a test must
  not ask a shared store for the last run. Test files run in
  parallel and in a random order (D28). Use `project()` in
  `test/setup.ts`.
- A sink must not throw on a closed pipe. An error handler that
  writes to the same pipe makes a loop.
- The benchmark guards catch real regressions. Run them.
- An import in a file that each test process loads has a cost in
  each process. Load such a module where it is needed
  (`process.getBuiltinModule`).
- Deno compiles TypeScript itself. A load hook there gets
  JavaScript. Test a Deno feature with the built package
  (`test/package.test.ts`).
- A bundle must not contain the text of a source map marker at
  the start of a line. Deno reads one in a string as the map of
  the bundle.
- A named import from a `node:` module that one runtime does not
  have stops each process on that runtime at load. Import the
  module as a whole, and test for the function.
- A push to `main` cancels the CI run of the push before it. To
  see a result, wait for the run to end before the next push.
- CI starts with no `.ubq/` folder. `rm -rf .ubq` before a local
  run finds defects that need an empty cache or a new store.
- CI can have a newer Bun and Deno than the developer machine. A
  test must not depend on data that changes with the version of a
  runtime.
- The tests remove `CI` from their environment (`test/setup.ts`).
  A test that needs it gives it to the run that it starts.
- Windows: a path has `\`, a temporary folder can have a short
  name (`RUNNER~1`), a command file of `node_modules/.bin` does
  not start with `spawn`, a link to a folder must be a junction,
  and there is no `SIGUSR1`, no process group, no socket file,
  and no `/dev/fd`.
- A unit test of a module that the library loads before coverage
  starts (`coverage.ts`, `counters.ts`, `stack.ts`,
  `child-read.ts`) imports a copy with a query
  (`'../src/stack.ts?copy'`). Otherwise V8 has no block counts.

## Machines and releases

- The user has a Windows 11 VM (ARM64). `ssh winlocal` runs a
  command in it. The copy of the repository is in
  `C:\Users\isaacs\ubq-vm\ubqtest`. It has no access to GitHub:
  copy files to it with `tar` through `ssh`.
- A release: set the version in `package.json`, push the tag
  `v<version>`, approve the staged version on npmjs.com, then
  `gh workflow run site.yml`. The user does it.

## Log

All entries are from 2026-11-11 to 2026-11-14.

- **Step 0.** Project files, the API and events documents, the
  first benchmark.
- **Step 1.** `test`, `describe`, assertions, stack places, the
  text sink. A test file runs as a plain program on Node, Deno,
  and Bun with the same result.
- **Step 2.** V8 coverage for each test, the store
  (`.ubq/runs.db`), and the query commands. Coverage starts in
  the same tick as the library load, so that V8 sees functions
  that never ran.
- **Step 3.** The runner: finds test files, one child for each
  file, events on fd 3. The store writes in short transactions,
  because two runs gave "database is locked".
- **Step 4.** Console capture for each test, reports of what a
  test left open, and a watchdog for a loop that does not return.
- **Step 5.** Source counters on Bun (D21, D22), because Bun has
  no V8 coverage.
- **Step 6.** Selection by test ID, `--failed`, `--changed`,
  `history`, `diff`, `--repeat`, `--baseline`, `slow`.
- **Step 7.** `cleanup`, `env`, `testdir`, `spy`, `fakeClock`
  (D30), `assert.snapshot` (D31), `mockImport` on Node and Bun,
  random file order (D28), and leak checks (D29).
- **Step 8.** The package build (D32), Deno parity (D33), type
  checks next to tests (D38), `GUIDE.md`, and `ubq doctor`. An
  agent on the smallest model used only the guide and wrote
  correct tests.
- **Release ready.** README, `docs/api.md`, CI on Linux, macOS,
  and Windows with each runtime as the runner, and the release
  workflow. Not published by the agent.
- **Conversion** (D43). `ubq convert`, `CONVERT.md`, and the
  `use-ubq` skill.
- **Windows.** The VM found and closed gaps: the stack of a stuck
  process, `ubq server` on a named pipe, and stack places with a
  drive path.
- **Browser tests** (D45, D47). `ubqtest/browser`, with coverage
  of code that runs in a page.
- **Web site** (D44, D46). Built from `site/` and the docs, and
  deployed to a Cloudflare Worker.
- **Change commands** (D41). `--changed` at the level of ranges,
  and `--diff` for `uncovered` and `mutate`.
- **JSX coverage** (D40) on Bun and Deno.
- **Bun inspector coverage** (D39) as an option. Bun issue 48712.
- **Background server** (D36, D37, `11-server.md`). Keeps test
  processes ready.
- **Mutation check** (D35). `ubq mutate`.
- **Hang reruns** (D14). A timed-out test runs again with
  `async_hooks` to find the place that opened each resource.
- **Source counters on Node** (D25). Faster than V8 for many
  files, and they correct stack columns.
- **Workers projects** (D48, D49, D50). Four reports from an agent
  that moved a Workers project from vitest
  (`12-` to `15-agent-feedback-*.md`). Tests now run in workerd,
  and `ubq convert` reads the vitest config.
- **`ubq uncovered` summary** (D51). The count names the files in
  the list, and the command exits with 1 if it lists code.
- **Coverage of ubq by its own tests** (D52 to D56). Coverage of
  child processes, merged coverage of all CI jobs, source maps of
  built files, and the `// ubq: not measured:` comment. Tests for
  the uncovered list found and corrected about 20 defects. The
  merged CI list went from 593 ranges to 5. About 165 ranges have
  a D56 comment: either they cannot have counts, or no test makes
  the case yet ("no test ...", which a later test can close).
- **EPIPE.** The command line ignores EPIPE on its stdout and
  stderr, so `ubq uncovered | head` has no error stack.
- **Small fixes.** The `ubq skill` help names all 7 agents. A stack
  path can have a space. `--diff` reads names that git quotes.
  `ubq show` names the error of a file that did not load. `doctor`
  reads the configs that a `tsconfig.json` extends. A fake timer
  with a time below 1 ms, or not a finite number, waits 1 ms, as in
  Node (D57). The raw output of a child process stays out of the
  text: the user decided that the runner prints only results.
- **Bench budgets** from a new baseline (2026-11-13). The machine
  was slower than at the first measurements.
- **Server count.** The background server counts a file as
  prepared only when it makes a new cache entry. The watcher of
  macOS can give two events for one change; the second one made
  `test/server.test.ts` fail two times in CI.
- **Load errors** in a folder whose name has a space have their
  place, on each runtime.
- **Mutate reruns** (D58). A change that only a file error or a
  timeout killed runs again, and counts as killed only if it fails
  again.
- **`ubq --update`** with no test writes all snapshots (D76).
  `ubq convert` changes the tap scripts `snap` and `snapshot` to
  `ubq --update`.
- **Release job.** The `stage` job does not run the tests. The CI
  workflow runs them, and a maintainer approves the staged version
  only if CI passed.
- **API reference links.** On the site, a name in the code of the
  API reference that is an item of the page links to its heading.
- **Failure limit.** A run prints 20 failure blocks at most, then
  the count of the others and `ubq failures <run>`. CI and `ubq
  failures` print all.
- **`--max-time <ms>`.** The run stops each file that runs at that
  time, with its process tree, and starts no more files. Each such
  file is a file error. No hang reruns after the limit.
- **Environment of a run.** The run record has `NODE_OPTIONS`,
  `NODE_ENV`, `TZ`, `LANG`, `LC_ALL`, `UBQ_COVERAGE`, and
  `UBQ_BROWSER` (store schema 9). `ubq failures` and `ubq show`
  name the ones that differ from the run before. Not the other
  `UBQ_` variables: the runner sets them for its test processes.
- **Lint and format.** `npm run lint` runs oxlint with `--fix`,
  then oxfmt, on `src`, `test`, and `scripts` (not
  `test/fixtures`). The configs are `.oxlintrc.json` and
  `.oxfmtrc.json`. All files are formatted.
- **Note of uncovered code** (D61). A run prints the count of the
  ranges that `ubq uncovered` lists in the files of the run, before
  the summary line. The default rules for test helpers and build
  files are regular expressions: the glob code of Node costs 2 ms
  when it loads. `uncovered` reads each distinct coverage of a file
  once.
- **Store page.** `docs/store.md` (the site page `/store/`) has
  each table and column of `.ubq/runs.db`, and example queries for
  `ubq sql`. A test fails if a column of the schema is not on it.
- **`ubq run <paths>`** (D62). Each argument is a path or an
  option. A command name that is also a file or folder in the
  working directory gets a note with this form.
- **`ubq lsp`** (D63). A language server: uncovered code and
  failures as diagnostics, the tests of a place on hover, an
  update after each run. `ubq nvim` writes the Neovim plugin
  (`nvim/`); a test runs a real headless Neovim with it, and skips
  if `nvim` is not installed. A code action runs the tests of the
  line of the cursor; `:UbqRunLine` in Neovim.
- **VS Code extension** (D64). `vscode/` is its own package, with
  its own lock file. `npm test` there runs the extension in a real
  VS Code (it downloads VS Code to `vscode/.vscode-test`, and opens
  a window). The CI job `vscode` runs it with `xvfb-run`. The
  workflow `vscode.yml` publishes it when a `v*` tag is pushed. It
  has the version of the package (the `version` script). It is not
  published yet: `vscode/PUBLISH.md` has the steps that need a
  person. Until the repository variable `VSCODE_PUBLISH` is `true`,
  the workflow makes the package and does not publish it. Remove
  the condition when the setup is done.
- **`ubq status`** (D66). The runs in progress, from
  `.ubq/now/<run>.json`: the files that run, the test that runs in
  each, and the counts. A run of one file shows only after the
  top-level code of its file.
- **Go to the tests of a place** (D65). The request `ubq/tests` of
  `ubq lsp`; `:UbqTests` in Neovim, `ubq.tests` in VS Code. The VS
  Code test checks one place only: the peek view of many places is
  not checked.

- **`ubq check`** (D67). Fails if a test failed in its last run,
  if code changed after its tests ran, if the last run had type
  errors, or if changed lines ran in no test. `--hook` is a stop
  hook of Claude Code, and `ubq skill` adds it to
  `.claude/settings.json`.

- **`ubq review`** (D68). The changes to the tests that a person
  must look at, from the git diff, the test files at the base and
  now, and the store: removed and skipped tests, fewer or changed
  assertions (and if the test runs changed code), snapshots, new
  `not measured` comments, and the `ubq` key. The CI job `coverage`
  writes the list as a comment on a pull request. Not checked yet
  on a real pull request.

- **What changed since the last pass** (D69). The block of a failed
  test names the lines that it ran in its last pass and that are
  different now, or says that none are.

- **Closest tests of a survivor** (D70). A `SURVIVED` block of `ubq
  mutate` names up to 3 tests that ran the code, the best place for
  a new assertion first.

- **Evals** (`evals/`). Seven small tasks with a trap each, for an
  agent (`claude -p`, with a model of `--model`) in a project of
  ubq, vitest, or `node:test`. The grades: hidden tests, false
  greens, a mutation score with `npm test`, and for ubq `check` and
  `review`. Scripted agents check the harness.

- **GitHub annotations** (D71). In GitHub Actions, failures, type
  errors, and the ranges of `ubq uncovered` are annotations at their
  lines.

- **The evidence of a pass** (D74). On a pass, `ubq check` prints
  the changes to the tests to look at, and the count of tests that
  pass: the end of the last message of an agent, or of a pull
  request.

- **Summary of a step** (D73). With `GITHUB_STEP_SUMMARY`, a run
  adds its result and a table of its failures to the summary of the
  step.

- **Color at a terminal** (D75). `FAIL`, `ERROR`, `TYPE`,
  `SURVIVED`, and `fail` are red, and `pass` is cyan. Not in CI, with
  `NO_COLOR`, or with `FORCE_COLOR=0`.

- **`assert.contains` and `assert.notContains`** (D77). A failure
  shows the text or the elements. `ubq convert` changes
  `toContain` and `toMatch` with text to them.

- **`ubq --version`** prints the version of the package.

- **One error for a file that throws.** A test file that throws
  before its first test has its error, and no second error that
  says that it registered no tests.

- **Convert, from the feedback on 0.0.15.**
  - TODO comments wrap at 75 characters.
  - When the expected value of an assertion starts on its own
    line, each argument goes on its own line.
  - `expect.arrayContaining` of literals becomes one
    `assert.contains` for each literal.
  - The report gives the command of the formatter of the project,
    names the files that still import the old tool, and has a note
    for each key of `miniflare` other than `bindings`.
  - The restore form of a helper (`restore = m.restore`, with
    `afterEach(() => restore())`) goes away, in the test files and
    in the helper, when all of its files are in the run.

- **Types on the API page.** `docs/api.md` also lists each type
  that the API uses and the package does not export, such as `Test`
  and `ErrorMatch`.

- **A hint for a type error in an expected value.** A type error in
  the expected value of `assert.equal`, `assert.notEqual`, or
  `assert.deepEqual` has a `hint:` line: the value must have the
  type of the actual value.

- **The `ubq` key in `ubq check`.** A change to the key shows each
  line of the key as indented JSON, with `-` and `+` lines.

- **A hint for a hook.** A file that calls `afterEach` (or another
  hook of an other tool) fails with a hint that ubq has no hooks.

- **`assert` after an import.** The parser read `assert` at the
  start of the line after an `import` as an import assertion. A
  source file of that form had no coverage, and `ubq convert`
  failed on a tap file with only top-level assertions. The word is
  now an import assertion only on the line of the import.

- **From the feedback on 0.0.16 (a tap project with tshy).**
  - A test file that ends before it loads ubqtest gets a message
    that says so.
  - `ubq doctor` names test files that do not import ubqtest and
    that import an old test tool or nothing, such as a snapshot
    file of tap.
  - For a tsconfig that makes JavaScript files, `ubq doctor` also
    asks for `rewriteRelativeImportExtensions`.
  - `--help` after a command prints the help.
  - `ubq mutate` names a test file that runs the changed code
    while it loads on its own line.
  - `ubq convert` writes a TODO for a message that is not text,
    and for `assert.fail` in a loop. Its report names `c8` and
    `istanbul` ignore comments, and counts a file with only
    top-level assertions as a file with tests.
  - CONVERT.md: when a tap test runs, empty test names, packages
    that the old tool brought, and the Node version of CI.

- **From the feedback on 0.0.16 (a large vitest project,
  `19-sonnet-feedback-0.0.16.md`).**
  - An import with no extension finds its file, and an import of
    a folder finds its index file, on Node and Deno (D78). A mock
    loader with such a path works on Bun.
  - `ubq doctor` names the files with syntax that Node cannot
    run, and does not ask for `erasableSyntaxOnly` for a project
    that needs Bun (D79). TS1294 has a hint. The command for Bun
    is `bun node_modules/ubqtest/cli.js`.
  - `ubq convert`:
    - `rejects.toBeInstanceOf` and `rejects.toMatchObject` become
      `assert.rejects`. Each other matcher after `rejects` gets a
      TODO. Before, the result was `await` on the promise, which
      throws.
    - `vi.spyOn` on an `import * as` name stays, with a TODO that
      has the `mockImport` call. A spy assertion on a name of
      such a module, or of a module with `vi.mock`, gets a TODO.
    - Two or more `toHaveBeenCalledWith` checks of one spy in a
      function become checks of any call.
    - `expect.stringContaining` becomes a RegExp only in a
      pattern. `expect.not.*` gets a TODO.
    - An optional chain gets no parentheses: `a?.b.length`.
    - `mockReturnValue({ ... } as T)` and `(s as Mock).mock.calls`
      gave text that was not code, and the file was not
      converted. The message for such a case now says that the
      place is in the new text.
  - Types: `assert.equal` keeps a `number`, `string`, `boolean`,
    or `bigint` wide, so a count can have a second check. It
    still narrows a literal union and `T | undefined`. `spy()` with
    no implementation takes any arguments and fits each function
    type.
  - Convert hints: a text for each timer function of `vi`, for
    `clearAllMocks`, `mockClear`, `stubGlobal`, `stubEnv`,
    `waitFor`, `mocked`, `hoisted`, `resetModules`,
    `importActual`, `expect.assertions`, `describe.each`,
    `skipIf` and `runIf`, `not.toThrow`, `toHaveProperty` with a
    path, and `toMatchInlineSnapshot`. The hint of `vi.mock`
    spreads the real module.
  - Convert forms: `toBeCalled` and the other names of matchers,
    `toHaveBeenNthCalledWith` with a number,
    `toHaveBeenCalledExactlyOnceWith`, `not.toHaveBeenCalled`,
    `not.toHaveBeenCalledWith`, and `toBeTypeOf`. A `test.each`
    or `describe.each` with a TODO keeps its name in the import.
  - Syntax that Node cannot run (D80): Node 26 has no
    `--experimental-transform-types`. The texts of doctor, of a
    load error, and of TS1294 tell the agent to ask the person:
    change the syntax, Bun, or a build.
  - `clock.set(time)` (D81).
  - `stub(object, key, value)` (D82). `ubq convert` changes
    `vi.stubGlobal` and `vi.stubEnv`.
  - The `define` key (D83). `ubq convert` writes it from the vite
    config.
  - Loops for `it.each` and `describe.each` (D84), and a TODO for
    a tagged template table.
  - `ubq convert`: `__dirname` and `__filename` become
    `import.meta.dirname` and `import.meta.filename`. A TODO for
    `require`, an `enum`, a parameter property, and a jsdom
    comment. A top-level `beforeAll` block has no `;` after it.
    `const s = vi.fn() as T` loses the cast. A note for a vite
    config with plugins.
  - `exports.default.fetch()` of `cloudflare:workers` calls the
    Worker under test, as `SELF` of the vitest plugin did (D115).
  - The `skipTypecheck` key, the `env` key, and a hint for an
    import of a name of an alias or of `paths` (D114).
  - From the vitest monorepo report (D113): no test files from
    `dist` by default, a hint for TS6305, and two forms and two
    notes in `ubq convert`. Q45 to Q48 are open.
  - The `transform` key: the typescript or swc package of the
    project makes the JavaScript of source that Node cannot run,
    with `mockImport` for CommonJS (D111).
  - The type check writes `tsconfig.ubq.json` for a folder whose
    `tsconfig.json` has only references (D110).
  - `spy.results(a, b)`, and `toHaveBeenCalledWith` is a check
    of any call in `ubq convert` (D109).
  - From the nest and jest report (D108): pnpm workspaces, a FIX
    line for a tsconfig with only references, jest-dom checks and
    other forms of jest in `ubq convert`, a short form for a
    TODO text that a file has two times, and a helper file for
    Testing Library in the convert guide. Q40 to Q43 are open.
  - The runner starts one more test process at the same time
    than the machine has CPUs (D107).
  - A run with no cache is two times faster: the runner makes the
    counters cache one time, and the cache has TypeScript source
    with no types (D106).
  - `bench/`: a benchmark of 5 test tools on the same 20 test
    files, 306 tests, and 2330 assertions, in Docker with a fixed
    budget. The first results and three places where ubq loses
    time are in `bench/README.md`.
  - `mockImport`: an import in the new instance that names no
    file fails at the import statement, with the names of the
    project. With a link to the ubqtest package, the new instance
    gets the library of the test, not a second copy.
  - The end of a test file waits for the end of its events pipe.
  - `ubq convert` knows Playwright Test (D105): the page of a
    test, and the checks that wait.
  - `assert.greaterThanOrEqual` and `assert.lessThanOrEqual`
    (D102). A `not measured` comment before the first code of a
    file: no test can load the file (D103). A CI job for Node
    22.18.0 (D104).
  - From the 0.0.18 conversion report (D101): the `since` line
    names changed lines that ran while the file loaded, a test
    that does not await fails if it ends after its limit,
    `ubq slow` shows the last run of all tests, and config files
    are build tools.
  - ubq runs on Node 22.18 or later, with two workarounds for
    faults of Node, and `ubq doctor` tests the functions that it
    needs (D100).
  - `assert.equal` does not narrow the type (D98).
  - `assert.greaterThan`, `assert.lessThan`, and `assert.close`
    (D99). `ubq convert` writes them, and keeps the precision of
    `toBeCloseTo`.
  - `ubq convert` knows tape and ava. A `t.end()` in a callback
    and a `t.plan(n)` of a test with a callback get a TODO, also
    for tap (D97).
  - A type checker that stops with no result fails the run. The
    count of type errors in other files is in the summary line,
    not in a note (D96).
  - `ubq convert` runs the formatter of the project on the files
    that it changed (D95).
  - `ubq doctor` checks the options in the `tsconfig.json` that
    has the test files, and gives the file to add if none has
    them (D94).
  - `CONVERT.md` has the form for a test that needs jsdom (D93).
  - A failed `assert(value)` shows the values of the
    `isDeepEqual` calls before it (D91).
  - `ubq convert` makes a setup function from `beforeEach` and
    `afterEach` hooks that assign no outer variable, and calls it
    in each test (D90). In the sentry corpus this changes about
    130 of 211 hooks.
  - `assert.rejects` takes a `PromiseLike`. `ubq convert` makes
    `toThrow(error)` with an Error instance a pattern for the
    message (D89).
  - A function in an `assert.match` pattern is a predicate (D85).
    `ubq convert` changes `expect.any` and `expect.anything` in a
    pattern.

- **Snapshot files with CRLF line ends.** Git on Windows can check
  a snapshot file out with CRLF line ends. ubq then found no
  entries, and each `assert.snapshot` failed. ubq now reads such a
  file. A CR of a value is `\r` in the file. A snapshot of an
  older version with a CR and LF in a value fails one time: run
  `ubq --update`.

## Open, waiting for a decision

- Bun 1.4.4 (CI) gives inspector coverage of a plain program with
  only the module range. ubq then stores only the first character
  of each file. Bun 1.4.3 gives places. The 5 ranges that stay in
  the CI list, all in `src/bun-coverage.ts`, are there for this
  reason.
- A Workers test file that throws after its first `test()` call
  gives "the test process ended before the file did ... in test:
  t", with a stack frame of `src/workers-entry.ts`. On Node the
  same file gives a plain load error.

## Ideas for later

Each idea waits for a real project that needs it (D60).

- `ubq weak`: the tests that run no code that other tests do not
  run.
- A seeded random source, with the seed in the failure report.
- A check of globals, for each test or for each test file.

## Not done, and known limits

Each item is still open. Remove it when it is done.

Core and runner:

- Bun gives different columns for some frames, and no place for an
  assertion in a timer callback.
- Bun gives no place for a failure in a test whose body is one
  expression: `test('x', () => assert.equal(1, 2))`. The failure
  then has the place of the `test()` call, as a failure with no
  stack does.
- Bun on macOS cannot open a WAL database read-only if it has no
  `-shm` file ("unable to open database file"). `ubq lsp` and the
  tests do not open the store read-only. `src/baseline.ts` and
  `src/merge.ts` still do.
- The watchdog uses inspector port 9229. If a different process
  has it, the failure has no stack.
- When the watchdog stops a process with no runner, the store gets
  no run, and the exit code is 137. Node prints "Debugger
  listening" when the watchdog starts the inspector.
- A hang report on Bun has no stack (no `SIGUSR1` inspector). On
  Deno, a plain program in a loop gets no stack.
- A new schema version removes the old store. Two `ubq` processes
  that start at that time can fail one time.
- `test/mutate.test.ts:100` failed one time in CI (Bun job, macOS,
  Bun 1.4.4): 0 of 4 changes survived, not 1. Cause not found.
  Blocked: the permission check does not allow a download of Bun
  1.4.4 here, and Bun 1.4.3 does not show it. Ruled out on this
  machine:
  - a pause of the test process: under heavy load, `test-start` to
    `test-end` was 1 ms at most (the runner stops a test after
    3000 ms in a mutation check);
  - the counters cache: changed source is never in it;
  - lost events: fd 3 blocks with each runtime as parent and child;
  - the write of child coverage: it is in a `try`.
  Six full Bun runs under load, and many runs of the test, passed.
  It failed a second time in CI, in a Node job on macOS, at the
  same Bun step. Two more full CI runs passed. Since D58, a change
  that only a file error or a timeout killed runs again, so such a
  failure no longer fails the test. The test logs each first-run
  kill of that change (`UBQ_MUTATE_LOG`, temporary) as its output:
  `ubq show` on the store of a macOS CI job shows it. The test
  also depends on the stored coverage of a test that its file no
  longer has ('not below zero').
- Many test files run `ubq` in `test/fixtures` and share its
  store. A test that reads a row from that store can see the rows
  of a different file. `test/bun.test.ts` has its own project now.

Selection and history:

- `--changed` does not see a change in a file that no test loaded
  as code (JSON, config, lock file). No "run all tests" for such a
  change. The flaky note of `history` has the same gap, and
  compares runs on one runtime only.
- The changed part of a file is one span. Two changes far apart
  select each test that ran code between them.
- With nothing to run, `--failed` and `--changed` exit with 2.
- `--repeat` runs the repeats one after the other.
- `--baseline` checks out only the files of the commit (no build
  output, `.env`, or submodule). It does not go with `--repeat`,
  `--failed`, or `--changed`.
- `diff` lists a test that ran in only one run only if it failed
  in the second run.
- The store keeps the rows of a test file that is gone. `ubq
  covers` can name a test of such a file.
- The output of a test that passes shows only in `ubq show`.

Coverage:

- A file that the parser cannot read gets no counters. On Bun it
  gets no second try with its types removed.
- Counters after `return` or `throw` exist only at statement level.
- On Deno, the removal of types runs again in each process.
- Deno from the source (`deno run -A src/cli.ts`) cannot load the
  parser in a module hook, so CI runs Deno with the built runner.
- The runner on Bun does not get coverage of a child with a new
  environment.
- A JSX project that runs on Node through its own load hook is
  not tried.
- Source maps: no index maps (`sections`), no `webpack://`
  sources, and no languages that the parser does not read (Vue,
  Svelte). Browser coverage: no bundle of many files, and no
  source map in a separate file.
- With `UBQ_COVERAGE=v8`, one check in `test/fixtures.test.ts`
  fails: V8 gives coverage to a module that loaded and did not
  run. Counters give none, which is correct.
- The "no test ..." D56 comments mark ranges that a later test
  can cover.

Mocks, fixtures, clock:

- On Bun, a string in a mocked instance that looks like an import
  of a mocked path gets the mock number too.
- A file with top-level fixtures that calls `test` after an
  `await` that follows the first `test` call gets an error.
- On Bun and Deno, a name imported from `node:timers` keeps the
  real timer under a fake clock.
- Timers that wait when a fake clock ends are dropped with no
  message.
- `mockImport` does not replace a `require` dependency, and a mock
  of a package does not reach other packages. Its hooks stay for
  the life of the process.
- Two tests whose names differ only in characters that are not
  safe in a path share one `testdir` folder.

Type check and doctor:

- `doctor` does not read the `tsconfig` field of a package that a
  config extends. It reads `<package>/tsconfig.json` and
  `<package>.json`.
- A run of one file that ends with `process.exit` before the type
  check ends reports no type errors.
- On Windows, a type checker that is stopped after it wrote some
  errors looks like a checker that ended (D96).
- `doctor` reads only relative imports to find the files that the
  tests import. It does not read path aliases (D101).

Node versions (D100):

- CI runs Node 22.18.0 on Linux only, and no version between it
  and the newest Node 24 (D104).
- `require('./file')` with no extension in a CommonJS test file
  needs Node 24.18 or later of Node 24, or Node 26.5.

Check and review:

- `ubq review` does not compare a converted test with the test
  of the old tool (D101).

Server, mutate, hang reruns:

- The server does not make a run of many files faster, and does
  not start by itself. `experiments/server/warm.mjs` needs the
  built package.
- Not checked: that only the user of the server can connect to
  its named pipe on Windows.
- `mutate`: no changes for a file that the parser cannot read or
  for JSX on Deno, one process at a time when all tests are in
  one file, no option for kinds of changes, no way to accept a
  survivor, and no support for `UBQ_COVERAGE=v8`.
- Hang reruns run one after the other and each waits for its time
  limit. None on Bun or with `--repeat`. On Deno, no place for a
  server that a test opened. A rerun runs the top-level code of
  the file again.

Convert:

- A name of the old tool that a local variable hides gets the
  rule of the old tool.
- A helper file that gets `t` as an argument is not converted.
- A comment between the arguments of a changed call goes away.
- `beforeAll` in a `describe`, `expect.any` outside a pattern,
  and `expect.arrayContaining` stay hand work.
- Playwright Test: hooks, fixtures other than `page` and
  `context`, a check with `not` on a value or with its own time
  limit, and `playwright.config` stay hand work (D105).
- A `t.plan(n)` of tap or tape with no `t.end()` in a test that
  has a callback stays, with a TODO. ava hooks, `t.context`, and
  macros stay hand work.
- No sentence in the output for a project helper that returns a
  restore function.
- `const spy = vi.fn()` becomes `const spy = spy()`: the local
  name hides the import.
- A type that names the old tool (`ReturnType<typeof vi.fn>`,
  `Mock`) stays, with no TODO.

Browser:

- The runner on Bun and on Deno was checked by hand, not by a
  test.

Workers:

- `testdir`, `mockImport`, and `assert.snapshot` in workerd.
- Hang reports: what a test left open, and the stack of a test
  that blocks the thread.
- A `SELF` fetcher, storage for each test, JSX files, test values
  for bindings that are not in the wrangler config, other helpers
  of `cloudflare:test` (queues, Durable Object internals,
  Workflows), and `fakeClock` for `node:timers` names.
- The background server does not keep workerd processes ready.
- A method call (RPC) on the stand-in of a service throws
  "internal error", with no name of the service.
