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
