# Measurements

Numbers that the architecture in `04-architecture.md` depends on.
The scripts are in `experiments/` (see `experiments/README.md`).

**Machine.** Apple M3 Max, 16 cores, macOS (Darwin 25.6).
**Runtimes.** Node 26.5.0, Deno 2.9.6, Bun 1.4.3.
**Date.** 2026-11-11.

All times are wall time unless a row states a different unit. The
numbers come from one machine. Treat ratios as more reliable than
absolute values.

## 1. Summary of findings

1. A per-test coverage snapshot on V8 costs 0.13 ms at the least.
   It grows with the count of functions that the process loaded:
   about 0.5 ms for a small project, 1.5 ms with a large library
   loaded, 3.5 ms at 50000 functions.
2. Only one V8 coverage mode gives correct data for each test:
   `callCount: true, detailed: true`. The cheaper modes lose data
   after a function gets hot.
3. That mode makes hot arithmetic loops up to 13 times slower. Code
   that allocates and calls library functions is about 6% slower.
4. A Node process costs 27 ms to start on this machine. 17 ms of
   that is the load of the binary (`node --version` takes 17 ms).
   No flag makes it shorter.
5. TypeScript type stripping adds 19 ms to each Node process. The
   compile cache removes all of it.
6. With a process for each file and per-test coverage on, a
   prototype ran 200 files in 747 ms. That ties Jest with no
   coverage, and it is about 2 times faster than `node:test` and
   Vitest in their default modes.
7. `bun test` ran the same 200 files in 38 ms. A tool on Node
   cannot match that for a full cold run, because 2 Node processes
   already take longer.
8. The event transport is not a bottleneck. All methods cost about
   1 microsecond for each event.
9. SQLite is cheap: 1 ms to open, 0.74 microseconds for each row.
10. Always-on async hooks make await-heavy code 5 times slower.
    `AsyncLocalStorage` alone costs nothing that I could measure.
11. The runner can read the stack of a child in a busy loop in
    40 ms, with no cost in a normal run.
12. Per-test coverage through the inspector works on Node and
    Deno. It does not work on Bun. Bun can use counters in the
    source, through a load plugin and a preload (section 11).
13. `module.registerHooks` gives typed, scoped module mocks with no
    flags and no source transform.

## 2. Coverage

### 2.1 Which V8 mode is correct

Script: `coverage/binary.mjs`. It runs 4 "tests" and takes a
snapshot after each one. Function `f` gets hot in test 1.

| Mode | Per-test data | Hot loop time |
| --- | --- | --- |
| `callCount: true, detailed: true` | correct, with branch ranges | 2215 ms |
| `callCount: false, detailed: true` | wrong: omits `f` in test 4 | 2219 ms |
| `callCount: false, detailed: false` | wrong: omits `f` in test 2 | 135 ms |

`takePreciseCoverage` resets the counters, so each snapshot holds
only what ran since the last one. `getBestEffortCoverage` returns
all functions each time and costs 10 to 50 times more.

### 2.2 Cost of code that runs with coverage on

Script: `coverage/hot.mjs`. Best of 5.

| Workload | Off | Function counts | Block counts |
| --- | --- | --- | --- |
| Arithmetic loop, 30 million calls | 178 ms | 1238 ms | 2323 ms |
| JSON parse, map, filter, 3000 rounds | 118 ms | 132 ms | 125 ms |

V8 does not optimize functions fully while it must keep exact
counts. Most test code is cold code, so the second row is the
typical case. `c8`, Vitest, and `node --test` use the same V8 mode,
so this cost is the same as in those tools.

### 2.3 Cost of a snapshot at each test end

Script: `coverage/take.mjs`. 20 functions called in each test.

| Functions loaded | Snapshot (block mode) |
| --- | --- |
| almost none (`empty.mjs`) | 0.13 ms |
| 1000 | 0.48 ms |
| 10000 | 1.26 ms |
| 50000 | 3.49 ms |
| small project plus the TypeScript 5.9 compiler | 1.53 ms |

The cost follows the count of loaded functions, not the count of
functions that ran. The data that comes back is small (about 12 KB
of JSON for 20 functions).

Start of coverage costs 1.6 ms for each process.

### 2.4 Other coverage facts

- **Late start works for functions.** If coverage starts after a
  module loaded, functions of that module still get block data
  when they run later (`coverage/late.ts`).
- **Late start loses module top-level code.** Code at the top
  level of a module that ran before the start has no entry.
- **TypeScript offsets are correct.** Node replaces types with
  spaces, so V8 offsets point into the original `.ts` file. No
  source map is necessary.
- **Tests must run one at a time in a process.** A snapshot
  contains all code that ran since the last snapshot. If two tests
  run at the same time, the tool cannot split their coverage.

## 3. Start cost

Scripts: `start/warm.mjs`, and `hyperfine` on empty files.

| Unit | Time |
| --- | --- |
| `node e.mjs` | 28 ms |
| `node e.ts`, no compile cache | 47 ms |
| `node e.ts`, compile cache | 29 ms |
| `node --version` | 17.6 ms |
| `deno run e.ts` | 8.3 ms |
| `bun e.ts` | 5.1 ms |
| Worker thread, from a warm process | 10.8 ms |
| Worker thread that imports a `.ts` file | 28.5 ms |
| VM context | 0.16 ms |
| Process, 16 at a time, amortized for each | 2.6 ms |
| Worker, 16 at a time, amortized for each | 1.2 ms |

Under a 16-way load, each Node process uses about 41 ms of CPU to
start. For 200 files, that is a floor of about 510 ms for a design
with one process for each file.

In a Node process, user code starts 11.5 ms after process start.

## 4. Other frameworks

Suite: 200 test files, 10 tests in each, 1 deep equality assertion
in each test. 20 TypeScript source modules. Script: `suite/gen.mjs`.
Versions: Vitest 5.1.0, Jest 30.5.2 with `@swc/jest`, tap 21.8.1.

| Tool | 1 file | 200 files | 200 files with coverage |
| --- | --- | --- | --- |
| `bun test` | 7 ms | 38 ms | 38 ms |
| `deno test` | 33 ms | 4778 ms | |
| `deno test --parallel` | | 719 ms | 950 ms |
| `node --test` | 105 ms | 1439 ms | 1802 ms |
| Vitest, default | 234 ms | 1613 ms | 1970 ms |
| Vitest, threads, no isolation | | 343 ms | |
| Jest | 295 ms | 768 ms | 1898 ms |
| tap | 740 ms | 14150 ms | 21044 ms |

None of these tools record coverage for each test. Their coverage
columns are for one total for the run.

## 5. Prototype of the planned design

Scripts: `proto/lib.mjs`, `proto/runner.mjs`. The prototype runs
tests one at a time in each process, sends an event for each test
and each assertion, takes a coverage snapshot at each test end, and
writes all of it to SQLite. Same suite as section 4.

| Mode | Coverage on | Coverage off |
| --- | --- | --- |
| 1 file, `node file.ts`, no compile cache | 62 ms | 57 ms |
| 1 file, `node file.ts`, compile cache | 37.5 ms | 32 ms |
| 200 files, a process for each file | 747 ms | 628 ms |
| 200 files, a worker for each file | 563 ms | 361 ms |
| 200 files, 16 shared processes | 191 ms | 110 ms |
| 200 files, 4 shared processes | 338 ms | |
| 200 files, 1 shared process | 1196 ms | 127 ms |

The database write for the full run (2000 tests, 2000 assertions,
8000 coverage rows) took 16 to 18 ms.

Notes:

- In one shared process, coverage adds 1070 ms for 2000 tests,
  which is 0.53 ms for each test. Snapshot cost is the largest cost
  of the design after process start.
- The one-file path of the CLI (`proto/launch.mjs`: compile cache
  on, coverage on, then import the file) took 38.8 ms.
- The first snapshot after a file loads lists each module that
  loaded (`launch.mjs ... deps` printed the test file and its 2
  source modules). This is a dependency list at no extra cost.
- Shared processes run all the files of a group in one module
  graph. State in one file can change the result of a later file.

## 6. Event transport

Script: `transport/parent.mjs`. Events of about 200 bytes.

| Method | 1 child, 20000 events | 16 children, 2000 events each |
| --- | --- | --- |
| No events (start cost only) | 32 ms | 67 ms |
| `process.send`, one for each event | 71 ms | 94 ms |
| `process.send`, one batch | 44 ms | 64 ms |
| JSON lines on fd 3, a sync write for each event | 49 ms | 60 ms |
| JSON lines on fd 3, batched | 41 ms | 57 ms |
| JSON lines on stdout | 47 ms | 60 ms |
| Child writes its own SQLite file, runner merges | 57 ms | 79 ms |
| Children write to one shared SQLite file | 61 ms | 141 ms |
| Worker `postMessage`, one batch | 28 ms | 39 ms |

With 100 events for each child, all methods are equal within
noise. The shared SQLite file is the only method with a clear
penalty, because writers wait for the lock.

## 7. SQLite

Script: `sqlite/write.mjs`, on `node:sqlite`.

| Operation | Node | Deno |
| --- | --- | --- |
| Open and create the schema | 1.1 ms | 1.3 ms |
| Insert 52000 rows in one transaction | 38 ms | 59 ms |
| Query failures of a run | 0.08 ms | 0.66 ms |
| Query "which tests cover this offset" | 0.34 ms | 0.38 ms |
| Open an existing file and read | 0.31 ms | 0.36 ms |

File size was 1.6 MB for a run of 2000 tests with 20 coverage
ranges in each. `node:sqlite` also loads on Bun.

## 8. Async tracking and hang reports

Script: `hang/cost.mjs`. Workload: 200000 awaits, 2000 immediates,
200 file reads.

| Tracking | Time |
| --- | --- |
| None | 50 ms |
| `AsyncLocalStorage.run` around the work | 51 ms |
| `async_hooks` init hook, type only | 265 ms |
| init hook, stack for each resource but promises | 276 ms |
| init hook, stack for each resource | 2716 ms |

An init hook turns on promise hooks in V8, and that is the cost.

What works for a wedged test:

- **Open handles, with the line that made each one.**
  `hang/report.mjs` prints `TCPSERVERWRAP at startServer
  (report.mjs:6:55)`. This needs the init hook.
- **Handle types, with no hook.**
  `process.getActiveResourcesInfo()` returns the types at no cost.
- **Stack of a busy loop.** `hang/sigusr1.mjs`: the runner sends
  `SIGUSR1`, the child starts its inspector, the runner sends
  `Debugger.pause` on the WebSocket and gets the call frames. It
  took 40 ms and printed `parseForever` and `testBody`.

What does not work for a busy loop:

- `--report-on-signal` writes no report while JavaScript is in a
  loop (`hang/wd.mjs`).
- A worker thread with `connectToMainThread()` gets no pause event
  (`hang/watchdog.mjs`).

## 9. Runtime support

Scripts: `runtimes/caps.mjs`, `runtimes/cov-async.mjs`.

| Building block | Node | Deno | Bun |
| --- | --- | --- | --- |
| Per-test coverage through `node:inspector` | yes, sync | yes, async only | no data |
| `diagnostics_channel`, `tracingChannel` | yes | yes | yes |
| `AsyncLocalStorage` | yes | yes | yes |
| `async_hooks` init hook | yes | yes | no events |
| `process.getActiveResourcesInfo` | yes | yes | empty list |
| `module.registerHooks` | yes | yes | no |
| `module.enableCompileCache` | yes | no | yes |
| `node:sqlite` | yes | yes | yes |
| `using` declarations | yes | yes | yes |
| Sync write to fd 3, a pipe from a parent process | yes | no (bad descriptor) | yes |

On Deno, the inspector callback does not run in the same tick, so
the code must use the promise API. Deno does not give a child
access to fd 3 (`runtimes/fd3-parent.mjs`), so Deno needs a different
transport.

Later results (step 8): a Deno child can open `/dev/fd/3` and
write to it in the same tick. V8 coverage on Deno has the
positions of the JavaScript that Deno makes from TypeScript, not
of the source (D33).

## 10. Module hooks

Script: `hooks/use.ts`.

- `module.registerHooks` runs in the same thread and needs no flag.
- A resolve hook and a load hook give each mocked import its own
  new module instance, and replace the named dependencies.
- The type checker rejects a mock with a wrong signature
  (`hooks/bad.ts`).
- The resolve hook also records which module imported which
  module. This gives a dependency graph.
- A hook that a test library registers when it loads is too late
  for the static imports of the test file, because Node loads the
  full static graph before it runs any module.
- Coverage URLs of mocked instances carry the `?mock=N` suffix.
  The collector must remove it.

## 11. Bun coverage options

Scripts: `bun/jsc.ts`, `bun/plugin.ts`, `bun/static.ts`.

**`bun:jsc` `codeCoverageForFile` is not usable.**

- It throws "No source for file" unless the process starts with
  `BUN_JSC_useControlFlowProfiler=1`.
- It returns one line of table text (function percent, line
  percent, uncovered lines), not ranges.
- The numbers are totals since process start. It has no reset, so
  it cannot say which test ran a line that an earlier test also
  ran.
- It reported 100% of lines after a call that did not run the
  `return 'big'` line of the fixture.

**Counters in the source work.**

- `Bun.plugin` with an `onLoad` hook can change the source of a
  module at run time, with no flag. Hand-made counters in
  `src.ts` gave the correct counts (3 calls, 1 branch).
- Text inserted on the same line keeps line numbers correct. An
  error on line 5 of the changed source reported line 5. Column
  numbers move.
- A plugin that a module registers is too late for static imports
  of the same program (`static.ts` printed `false`). Bun loads the
  static graph first, as Node does.
- `bun --preload ./plugin-only.ts` applies the plugin to all
  modules.

Not measured: the cost to parse and change each file. That needs a
real instrumenter.

### Bun 1.4.3: precise coverage through `node:inspector` (2026-11-12)

Scripts: `bun/inspector.ts`, `bun/inspector-map.ts`,
`bun/inspector-cost.ts`.

- `Profiler.startPreciseCoverage` and `takePreciseCoverage` work
  in the process, with no flag. Each call gives the counts since
  the call before it, so the data is per test. Section 9 said "no
  data" for an older Bun.
- A module that loaded before the start gives data for the
  functions that run later, as on V8.
- **The positions are not those of the source.** Bun compiles each
  module to its own JavaScript (no types, different white space,
  `"` for `'`). The ranges are offsets in that text. `src.ts` has
  241 characters, and its last range ends at 115.
- A program cannot get that text or its source map.
  `Debugger.getScriptSource` does not exist, and
  `Debugger.enable` needs `inspector.open()`.
  `Bun.Transpiler.transformSync` gave text with the same offsets
  for this file, but it gives no map, and nothing states that it
  is the same text in all cases.
- `node:module` on Bun has no `stripTypeScriptTypes`.
- One snapshot costs 1.33 ms with 9 scripts (the parser of ubq
  loaded). Counters cost microseconds.

Result: counters stay the method on Bun. The inspector could give
coverage to a plain `bun test/foo.ts` and to files with no
counters, but only with positions from a guess (question Q8).

## 12. Source counters on Node

Scripts: `experiments/counters/` (`preload.ts`, `run.mjs`,
`hot-run.mjs`, `corpus.ts`, `semantic.ts`). Date: 2026-11-12.

The experiment preload adds counters through a
`module.registerHooks` load hook, with `src/instrument.ts`. It
keeps the changed source in a disk cache, by content hash. On a
cache hit, the process does not load the parser.

### 12.1 Speed

| Case | V8 snapshots | Counters, cache | Counters, no cache |
| --- | --- | --- | --- |
| One child process, 10 tests | 44.0 ms | 36.9 ms | 54.0 ms |
| 200 files, no store | 864 ms | 721 ms | 1221 ms |
| Hot loop, 30 million calls (161 ms with no coverage) | 2289 ms | 161 ms | |

- An empty Node program took 27.3 ms in the same session.
- The store adds about 50 ms to the 200-file numbers.
- The instrumenter reads 2 to 3 MB of source for each second. The
  cache is necessary: with no cache, the run is slower than V8.
- The 9 MB TypeScript compiler took 9.2 s to change. The cost per
  byte goes up with file size, because the check for early exits
  walks nested blocks again.

### 12.2 Does the changed source stay valid?

`corpus.ts`, on all `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`
files in `experiments/node_modules` (9823 files, 93.5 MB), without
`.d.ts` and `.min.js`:

| Result | Files |
| --- | --- |
| Changed source parses again, and each line keeps its number | 9803 |
| The parser cannot read the file (it runs with no counters) | 20 |
| Changed source does not parse | 0 |

The 20 files: 14 declaration files with `.d.cts` or `.d.mts` names
(no code to run), 3 CommonJS files with `return` at the top level,
2 files with JSX in `.js`, 1 more declaration file.

In this repository, 46 of 47 files are read. `src/assert.ts` is
not: the parser does not accept a `const` type parameter on an
interface method.

### 12.3 Does the changed code behave the same?

`semantic.ts` runs two libraries with counters and compares the
results with the unchanged library:

| Library | Workload | Result |
| --- | --- | --- |
| acorn (ESM, 230 KB, 2641 counters) | parse 600 JavaScript files | 598 equal trees, 2 equal errors, 0 different |
| TypeScript 5.9 (CommonJS, 9 MB, 92505 counters) | compile 47 files with source maps | 47 equal outputs |
| TypeScript 5.9 | type check 2 files of `experiments/api` | 20 equal diagnostics |

The workloads ran 1701 of the acorn counters and 17797 of the
TypeScript counters. Code that the workloads did not run is not
verified.

### 12.4 Not tested, and known ways to differ from the original

- Code that reads its own source (`fn.toString()`) sees the
  counters.
- A function declaration as the direct body of an `if` (legal only
  in non-strict scripts) moves into a block.
- Counters are at statement level. If an expression throws in the
  middle of a statement, the rest of the statement counts as run.
  V8 block coverage has the same limit for most such cases.
- Files with JSX, and CommonJS files with a top-level `return`,
  get no counters.
- Only one machine and one Node version.

## 13. A browser for front-end tests (2026-11-12)

Scripts: `browser/pw.ts`, `browser/cdp.ts`, `browser/cov.ts`.
Playwright (`playwright-core` 1.65.0) with its Chromium headless
shell (158.0).

| Step | Node 26.5 | Bun 1.4.3 | Deno 2.9.6 |
| --- | --- | --- | --- |
| Start the browser | 73 ms | 71 ms | 85 ms |
| First page | 35 ms | 34 ms | 35 ms |
| A new context with a page | 59 ms | 60 ms | 58 ms |
| Close the browser | 17 ms | 16 ms | 16 ms |
| Connect to a browser that is already started, and a page | 68 ms | 75 ms | 71 ms |

1. Playwright works on the three runtimes with no change.
2. The first start after the download took 1413 ms. Each later
   start took about 75 ms.
3. A browser that the runner starts one time and shares saves
   about 40 ms for each test file (68 ms against 73 + 35 ms). A
   browser for each test file is simpler and costs little more.
4. The package is 14 MB. The browser is a download of 100 MB
   (205 MB on disk, 18 s on this connection). It is too large to
   put in the ubq package.
5. With no driver package, the same browser starts and connects
   in 80 ms, and makes a page and runs an expression in 25 ms
   (`browser/cdp.ts`, 40 lines). That is 28 ms less than
   Playwright. The driver does not cost much.
6. Playwright reports a page error and a `console.error` of the
   page as events. So ubq can fail a test for them.
7. Chromium gives the call count of each function of a script
   file that the page loads (`browser/cov.ts`): `a` 1, `b` 0. A
   script that is text in the HTML is not in the report.

## 14. The Workers runtime (2026-11-13)

Script: `workerd/load.ts`. `miniflare` 4.20260730.0 with `workerd`
1.20260730.1, on Node 26.5. The script starts one workerd process
with a D1 binding. A function of the script (the "module fallback
service" of workerd) gets each import that workerd cannot resolve.
It reads the file from the disk, removes the types with
`stripTypeScriptTypes` of Node, and gives the text back.

| Step | Time |
| --- | --- |
| Start workerd, load 2 `.ts` files, one D1 query | 65 ms |
| Start workerd, load `src/index.ts` (28 files), one test | 290 ms |
| A second request to the same worker | 3 ms |
| The first start after the install | 1580 ms |

1. workerd loads TypeScript files from the disk at the time of
   the import. No bundle step is necessary. This is the same place
   where the runner on Node adds the source counters, so coverage
   for each test can use the same code.
2. `cloudflare:workers` resolves, and a D1 query on a local
   database works.
3. The test API of ubq (`src/index.ts`, not changed) loads with
   the `nodejs_compat` flag and runs a test. The events of the test
   arrive on `node:diagnostics_channel`. The script had to change
   three things first:
   - `import.meta.url` and `import.meta.dirname` are undefined in
     a module from the fallback service. The script puts the
     values in the text.
   - `node:inspector` has no `Session`. Coverage must come from
     source counters.
   - `process.getActiveResourcesInfo` does not exist.
4. Not available in workerd: `beforeExit` and `exit` events (ubq
   uses them to know that a file ended), `worker_threads` (the
   watchdog), a real file system (`testdir`, snapshot files), and
   module hooks (`mockImport`).
5. The place of a test in its `test-start` event was wrong
   (`../entry.mjs`). The stack frames of workerd have paths with no
   `file:` scheme and no first `/`.
6. Not measured: many test files, one workerd for each file
   against one for all, and the cost of the counters.
7. A module that workerd loads cannot do I/O while it loads, also
   if a request started the `import()`: a D1 query at the top
   level of a test file fails ("Disallowed operation called
   within global scope"). `workerd/stack.ts` shows the form of a
   stack frame, that a timer is an object with `unref`, and that
   a CommonJS module gives only a default export.
8. The first event path was the stream of the response. An event
   that workerd wrote just before a loop that does not return did
   not always arrive. A request to the host that workerd waits
   for does arrive each time.
9. After the build of D48: `ubq` on the fixture Worker (1 file, 6
   tests, D1 migrations, a Durable Object) takes 0.7 s.

## 15. Coverage of child processes (2026-11-13)

Scripts: `child/bench.ts`, `child/cases.ts`, `child/preload.ts`.
Node 26.5, macOS. A test often starts the program under test as a
child process (a CLI, a server). A test process records only its
own code today.

### 15.1 How much of ubq do its own tests run?

The suite ran with `NODE_V8_COVERAGE` set, so each Node process
that it starts wrote its V8 coverage: 543 files, 230 MB. The union
for `src/`: 89% of the characters ran. The files at 0% run only in
Bun or in workerd (`bun-preload.ts`, `workers-entry.ts`,
`workers.ts`), or only with `UBQ_COVERAGE=v8` (`preload.ts`).

A test process with the files of ubq as project files (D52) sees
28 of the 53 files, with 291 uncovered ranges. The rest runs only
in child processes.

### 15.2 Two methods

- **V8 dumps:** `NODE_V8_COVERAGE=<folder>` in the environment.
  Each Node process writes all its scripts when it exits.
- **Source counters:** `NODE_OPTIONS=--import <preload>` in the
  environment. The preload adds counters to project files, as in
  a test process, and writes the counts when the process exits.

Time for one child process, mean of 20, and the data that it
writes:

| Child | No coverage | V8 dumps | Counters (source preload) |
| --- | --- | --- | --- |
| A script of one line | 33 ms | 36 ms, 104 kB | 68 ms |
| `ubq help` (35 project files load) | 86 ms | 93 ms, 275 kB | 91 ms, 4 kB |
| The parser on 150 files (the work is in a dependency) | 271 ms | 675 ms, 374 kB | 277 ms, 1 kB |

1. V8 coverage slows all code of the process, also dependencies:
   2.5 times here, and 14 times for a hot loop in section 12. The
   counters are only in project files.
2. The 68 ms of the counters for a script of one line is the load
   of the preload from 10 TypeScript source files. With the
   bundled preload of the package, the same script takes 37.3 ms,
   against 33.2 ms with no preload: 4 ms for each child process.
3. A V8 dump is 100 to 370 kB for each process, and the parent
   must read it (0.3 to 1.0 ms). The counts are 1 to 4 kB.
4. A V8 dump has the positions of the code that ran. In a nested
   test process, that is the source with counters, so the
   positions are not those of the file.

### 15.3 Hard cases for the preload method (`cases.ts`)

| Case | Result |
| --- | --- |
| The child starts a child with a new environment (`spawnSync`, `execFileSync`, `spawn`) | The preload ran in each one. It adds its variables in `ChildProcess.prototype.spawn` and in the sync functions. |
| A server that the test stops with SIGTERM | A handler of the preload ran, then the process ended with the same signal, as with no handler. The handler does nothing if the program has its own. |
| A worker thread of the child | The preload ran in the thread too. |
| Bun as the child | The preload ran, from `BUN_OPTIONS=--preload`. |
| Deno as the child | The preload did not run. Deno has `--preload` as an argument, and no variable for it. |

Not possible to catch: SIGKILL, and each kill on Windows. A write
on a timer keeps the counts up to the last write.

### 15.4 After the build of D53

- The suite of ubq: 14.75 s with child coverage, 14.25 s without
  (mean of 2). This repository loads the preload as TypeScript
  source in each child, which costs 35 ms and not 4 ms.
- `ubq uncovered` sees 50 of the 53 source files.
- A child that counts for two projects had two handlers for each
  signal. Each one saw the other and did nothing, so the child did
  not end. The handlers are now one set for the process.

