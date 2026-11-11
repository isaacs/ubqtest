# Architecture Plan

This plan follows the goals in `00-initial-prompt.md`, the ideas in
`01-agent-ideation.md`, and the decisions in `02-decisions.md`. Each
design choice below points at a number in `03-measurements.md`
(written as "M 2.3" for section 2.3 of that file).

Status: the user accepted the plan on 2026-11-11, with the answers
in `02-decisions.md` (D9 to D14). No product code exists yet.

Fixed points:

- The package is named `ubqtest`. The executable is named `ubq`
  (D13).
- The minimum Node version is 24, because the plan needs type
  stripping, `node:sqlite`, `module.registerHooks`, `using`, and
  the compile cache with no flags. Raise it when a feature needs a
  newer version (D12).
- The end state is one npm package with no dependencies at install
  time. The source has separate parts, and the build makes one
  small bundle (D13).

## 1. Parts

```
test file ──imports──> core library
                          │ publishes typed events
                          ▼
                 diagnostics_channel
                          │
        ┌─────────────────┼──────────────────┐
        ▼                 ▼                  ▼
   text sink          db sink          pipe sink (fd 3)
   (stdout)          (SQLite)               │
                                            ▼
                                         runner ──> text sink
                                                ──> db sink
```

| Part | Job |
| --- | --- |
| **Core library** | `test`, assertions, fixtures. Runs tests, publishes events. Works in a plain program. |
| **Events** | The typed, versioned event definitions. All other parts depend on these and on nothing else in the core. |
| **Coverage collector** | Takes a snapshot at each test end, publishes a coverage event. Two implementations: V8 precise coverage (Node, Deno) and source counters (Bun). |
| **Sinks** | Consumers of events: compact text, CI text, database, JSON lines pipe, JSON lines dump. |
| **Store** | The SQLite schema, the writer, and the queries. |
| **Runner** | Finds test files, selects tests, starts a process for each file, reads events from each child, feeds the sinks, handles timeouts. |
| **CLI** | `ubq` runs tests. Subcommands query the store. |
| **Module hooks** | Typed module mocks through `module.registerHooks`. |

One test process has two possible setups:

- **Plain program.** `node test/foo.ts`. The core library attaches
  the text sink and the database sink in the same process.
- **Child of the runner.** The runner sets an environment variable.
  The core library attaches only the pipe sink. The runner owns
  stdout and the database.

The sinks are the same code in both setups. The runner feeds them
events that it read from pipes. A plain program feeds them events
from `diagnostics_channel`.

## 2. Process model

**One process for each test file. Tests in a file run one at a
time. Files run in parallel.**

Reasons:

- Coverage for each test needs serial tests in a process (M 2.4).
- A process for each file removes shared state between files. The
  failures that shared state causes depend on run order, and those
  are the hardest failures for a weaker model to debug (D3).
- The cost is known: about 41 ms of CPU for each file under load
  (M 3). The prototype ran 200 files in 747 ms with coverage on
  (M 5). That ties or beats each Node-based tool that isolates
  files (M 4).

Worker threads are not in the first version. They save 25% of the
time (M 5), but `process.chdir` does not work in a worker, and
`process.env`, signal handlers, and native addons are shared with
other files. Shared processes ran the suite in 191 ms (M 5). Both
stay as later options for projects that accept less isolation
(D9).

**Fast path for one file.** When the selection contains one file,
the CLI does not start a child. It turns on the compile cache and
coverage, then imports the test file into its own process. The
prototype measured 37.5 ms for this case (M 5). This is the common
case in an edit loop.

**Scheduling.** The runner starts files in this order: files that
failed in the last run, files that cover changed code, then all
others with the slowest first (from stored durations). The first
failure prints at once.

**Child flags.** The runner starts each child with the compile
cache on (saves 19 ms for each file, M 3) and with a preload module
that starts coverage before any user module loads. A plain program
has no preload, so it loses coverage of module top-level code that
ran before the core library loaded (M 2.4). The tool marks such a
run in the store as "partial coverage".

## 3. Events and transport

The event types, as a sketch. The real definitions get their own
document before any code.

| Event | Main fields |
| --- | --- |
| `run-start` | run ID, command, runtime, version, platform, seed, git commit, dirty flag |
| `file-start` | file, process ID |
| `test-start` | test ID, parent ID, file, line, column |
| `assert` | test ID, ok, kind, line, column, message, diff data |
| `output` | test ID, stream, text |
| `test-end` | test ID, status, duration, assertion count, error |
| `coverage` | test ID, list of file, start, end, count |
| `hang` | test ID, handle types, stack, creation stacks |
| `file-end` | file, exit code, signal |
| `run-end` | counts, duration |

Each event has a version field. A passing assertion carries only
the test ID and `ok`, so the common case stays small.

**Transport: JSON lines on file descriptor 3.** The child collects
the events of a test and writes them with one sync write at the
end of that test.

- Speed is not a factor. All methods cost about 1 microsecond for
  each event (M 6).
- A sync write cannot be lost if the process exits or dies after
  the write returns.
- JSON lines are plain text. A person can read them, and any
  runtime can write them.
- Stdout stays free for the output of the code under test.

Children do not write to the database. Writers to one SQLite file
wait for each other (M 6).

Deno does not give a child access to fd 3 (M 9). The pipe sink
hides the method, so Deno can use a different one. The choice for
Deno is open (a socket path in an environment variable is one
option) and needs a test in step 7.

## 4. Coverage

**Method: V8 precise coverage through `node:inspector`, with
`callCount: true, detailed: true`.** This is the only mode that
gives correct data for each test (M 2.1).

Flow:

1. Start coverage as early as possible in the process.
2. Take one snapshot after the test file loaded. It lists each
   module that loaded, which is the dependency list of the file.
3. Take one snapshot at each test end. Keep ranges for project
   files only. Drop `node_modules`, the tool itself, and runtime
   internals. Remove the `?mock=N` suffix from URLs (M 10).
4. Publish a `coverage` event with byte offsets.
5. The store converts offsets to lines when a query needs lines.
   Offsets point into the original TypeScript source (M 2.4).

Cost and how the plan pays for it:

- A snapshot costs 0.13 to 3.5 ms, by count of loaded functions
  (M 2.3). A process for each file keeps that count low.
- Coverage counters slow hot loops by up to 13 times and typical
  code by about 6% (M 2.2). The plan accepts this (D1). Other
  tools that use V8 coverage pay the same cost.
- Subtests: a snapshot at the end of each leaf test. A parent test
  gets the union of its children plus its own code.

### Source counters, for Bun

Bun has no usable API for per-test coverage (M 11), so the Bun
collector adds counters to the source (D10).

- A load plugin (`Bun.plugin`) parses each project file and inserts
  a counter at each function start and each branch. It inserts
  text on the same line, so line numbers in stack traces stay
  correct (M 11). Bun then compiles the TypeScript as usual.
- Each counter maps to a source range. The collector publishes the
  same `coverage` event as the V8 collector, so the store and the
  queries do not change.
- A snapshot reads the counter array and sets it to zero. This
  costs microseconds, and the counters do not stop optimization.
- The runner starts each Bun child with `--preload`. A plain
  `bun test/foo.ts` has no preload, so the plugin cannot change
  static imports (M 11). The tool states that such a run has no
  coverage, and names the `bunfig.toml` preload line that fixes it.
- The plugin needs a TypeScript parser. It goes into the bundle,
  so the package still has no dependencies at install time.
- The transformed source is cached by content hash.

Source counters could also replace V8 coverage on Node and Deno
later, if snapshot cost or hot-loop cost becomes a problem. They
need a preload there too.

A separate project can propose a per-test coverage API to Bun.
When Bun has one, the Bun collector can drop the counters.

## 5. Store

One SQLite file at `.ubq/runs.db` in the project root. The tool
writes `.ubq/.gitignore` with `*` in it, so the folder never
goes into git. The folder is in the project, so two git worktrees
do not share state.

Tables, as a sketch:

| Table | Contents |
| --- | --- |
| `run` | one row for each run, with all `run-start` fields |
| `source` | file path, content hash, for each run |
| `test` | run, test ID, file, line, status, duration, error |
| `assertion` | failed assertions in full, passed assertions as a count on `test` |
| `output` | captured console text for each test |
| `coverage` | test, file, start, end, count |
| `dep` | test file, loaded module |
| `hang` | hang reports |

Rules:

- The writer commits a batch every 50 ms while a run is in
  progress, so other processes can query partial results.
- Cost is low: 1 ms to open, 0.74 microseconds for each row (M 7).
- Retention: status and duration for the last 50 runs. Coverage,
  output, and assertion detail for the last run of each test only.
  Both limits need a check against real project sizes.

Queries the CLI must answer (from `01`, sections 3 to 6):
`failures`, `show <test>`, `diff <run> <run>`, `history <test>`,
`slow`, `uncovered <file>`, `covers <file>:<line>`, and a raw SQL
mode.

## 6. Test IDs and selection

- A test ID is the file path plus the names from the root test to
  the leaf: `test/parse.ts > parse > empty input`.
- Two tests with the same name under the same parent are an error.
  This keeps IDs unique and stable.
- The CLI also accepts `file:line`. It selects the test whose
  source range contains the line.
- Selection happens in the test process. The file still loads, and
  tests that do not match do not run. The summary states how many
  tests the selection left out.
- A selection that matches zero tests is an error (D2).

Selection modes:

| Flag | Selects |
| --- | --- |
| (none) | all tests |
| `<id>` or `<file>` or `<file:line>` | the named tests |
| `--failed` | tests that failed in the last run |
| `--changed` | tests that the changes since the last run can affect |

`--changed` works from the store:

1. Compare the content hash of each file with the hash in the last
   run.
2. Select each test that ran code in a changed file, and each
   changed or new test file.
3. If a changed file has no coverage data (a config file, a
   fixture, a lock file), run all tests and state the reason.

The first version works at file level. A later version can use
ranges, so that a change in one function selects only the tests
that ran that function.

**No result cache in the first version.** A cache that skips a test
by mistake reports a pass that did not happen. File reads and
environment variables are inputs that the dependency list does not
contain. `--changed` gives most of the speed, and the user asks for
it by name, so the output can state plainly what did not run.

## 7. Failure checks

These checks make a wrong pass hard to produce (D2, D3).

| Case | How the tool detects it |
| --- | --- |
| Zero assertions | count on `test-end` |
| Assertion after the test ended | the `t` object knows that it ended, and `AsyncLocalStorage` identifies the test for free calls (M 8: no cost) |
| Unhandled rejection, uncaught error | process event, plus `AsyncLocalStorage` for the test |
| Test promise never settles and the event loop is empty | the process is about to exit while a test is open |
| Filter matched nothing | count in the runner |
| Duplicate test name | check at `test-start` |
| Child died | `file-end` with a signal or a missing `test-end` |

Console capture: the core library replaces the write functions of
stdout and stderr in a child. `AsyncLocalStorage` gives the current
test. The text becomes an `output` event.

## 8. Timeouts and hangs

Async tracking is off in a normal run, because an init hook makes
await-heavy code 5 times slower (M 8).

| Wedge | Detection | Report |
| --- | --- | --- |
| Test waits on something that never comes, handles are open | timer in the test process | handle types from `getActiveResourcesInfo` (no cost) |
| Test waits, no handles | process is about to exit with an open test | "promise never settled, nothing was pending" |
| Busy loop | runner sees no events for the time limit | runner sends `SIGUSR1`, connects to the inspector, and reads the stack (40 ms, M 8) |

After a timeout, the runner kills the process group of the child,
so child processes of the test die too.

For creation stacks ("which line opened this server?"), the runner
runs a timed-out test one more time, alone, with the init hook on.
It stores the result as a `hang` event. The limit is 3 such reruns
for each run. This is on by default, and a config switch turns it
off (D14). With the switch off, the failure block prints the
command that does the rerun.

## 9. Output

Two text sinks, as in D4:

- **Compact** (default): nothing for a pass, one block for each
  failure, one summary line.
- **CI** (when `CI` is set): the same, plus console output, full
  diffs, hang reports, seed, and runtime for each failure.

Each failure block ends with the command that runs that test again.
The summary line has a fixed format and includes the run ID.

Exit codes, as a proposal:

| Code | Meaning |
| --- | --- |
| 0 | all selected tests passed |
| 1 | one or more tests failed |
| 2 | no tests matched |
| 3 | coverage below the required level |
| 4 | error in the tool, the config, or the command |

## 10. Module mocks

`module.registerHooks` supports this with no flags (M 10):

```ts
const subject = await t.mockImport<
  typeof import('../src/subject.ts'),
  { '../src/dep.ts': typeof import('../src/dep.ts') }
>('../src/subject.ts', {
  '../src/dep.ts': { fetchUser: id => ({ id, name: 'x' }) },
})
```

- The type checker rejects a mock that does not match the real
  export (M 10).
- Each call gives a new module instance. Nothing leaks into the
  next test.
- No hoisting and no source transform.

The exact signature belongs in the API document. The mechanism is
proven.

## 11. Runtimes

| Feature | Node | Deno | Bun |
| --- | --- | --- | --- |
| Run tests, events, text output | yes | yes | yes |
| Store | yes | yes | yes |
| Per-test coverage | V8, sync API | V8, async API | source counters (section 4) |
| Module mocks | `registerHooks` | `registerHooks` | `Bun.plugin` resolve and load hooks, not tested yet |
| Transport from a child | fd 3 | not fd 3 (M 9), method open | fd 3 |
| Hang reports | yes | not tested | handle list is empty (M 9), needs its own method |

The order is Node, then Bun, then Deno. Bun comes before Deno
because of its growth in agent workflows (D10).

The V8 collector must use the promise form of the inspector API so
that one code path works on Node and Deno.

## 12. Speed budget

Targets on the machine in `03`, for the suite in M 4. A benchmark
in the repository must check these in each change.

| Case | Target | Basis |
| --- | --- | --- |
| 1 file through the CLI, coverage on | 45 ms | step 2 measured 43 ms; Node start is 27 ms |
| 1 file as a plain TypeScript program | 70 ms | step 2 measured 66 ms; type stripping is 19 ms of it |
| 200 files, full run, coverage on | 650 ms | prototype 747 ms; floor is 510 ms |
| Edit loop with `--changed`, 1 to 5 files | 40 to 80 ms | follows from the rows above |
| Query on a stored run | 35 ms | Node start plus 1 ms |

The first two targets were 40 and 65 ms before step 2. The
prototype did not have the store, and its 10 snapshots were
cheaper. In the real library, 10 tests take 4.8 ms (0.48 ms for
each, most of it the snapshot), coverage start takes 1.8 ms, and
the store takes about 1.5 ms.

Where the plan stands against other tools (M 4):

- Faster than `node --test`, Vitest default, Jest with coverage,
  and tap, by 2 times or more, with per-test coverage on.
- Equal to Jest with no coverage and to `deno test --parallel`.
- Slower than Vitest with isolation off (343 ms). Shared processes
  would beat it (191 ms).
- Slower than `bun test` in all cold cases. Bun starts in 5 ms and
  runs all files in one process. A tool on Node cannot match 38 ms
  for 200 files, and the user accepts that (D11).

The speed goal is: CI runs never get near a timeout, and the edit
loop feels immediate (D11). `--changed` runs the few tests that
matter, and stored results answer questions with no run at all.

Later speed work, in order of expected gain:

1. A background server that keeps warm child processes ready. It
   removes most of the 27 ms start from the edit loop.
2. Worker threads or shared processes as an opt-in for projects
   that accept the risk.
3. Range-level `--changed`.

## 13. Build order

Each step ends with a check that must pass before the next step.

| Step | Contents | Check |
| --- | --- | --- |
| 0 | Repository setup. Benchmark script with the suite from `experiments/suite`. API document and event document. | Benchmark prints the numbers of M 4. |
| 1 | Core library, events, compact text sink, plain program mode. | A test file runs with `node`, `deno`, and `bun`. Zero assertions fails. Plain program meets its budget. |
| 2 | V8 coverage collector behind a collector interface, store, database sink, query commands. | `covers` and `uncovered` give correct answers on a fixture project. |
| 3 | Runner, pipe sink, scheduling, CI sink, exit codes. The tool runs its own tests from here on. | 200 files in 650 ms. Exit codes are correct for each case. |
| 4 | Failure checks, console capture, timeouts, hang reports, process group kill. | A fixture for each row of the tables in sections 7 and 8. |
| 5 | Bun: source counter collector, preload, runner support. | The coverage fixtures of step 2 give the same answers on Bun. |
| 6 | Test IDs, `--failed`, `--changed`, `diff`, `history`, `--repeat`, `--baseline`. | An edit to one source file runs only the tests that cover it. |
| 7 | Module mocks, fixtures, fake clock, snapshots, random order with a seed. | Typed mock fixture fails to compile when the shape is wrong. Mocks work on Node and Bun. |
| 8 | Agent guide in the package, `doctor`, type checks next to tests, Deno parity, single bundle build. | An agent with no prior knowledge of the tool writes and fixes a test with only the guide. |
| Later | Background server, worker threads or shared processes, mutation checks, a per-test coverage API for Bun. | |

Until step 3, the tool's own tests run on `node:test`.

## 14. Open points

The user answered the first set of questions (D9 to D14). These
points are still open, and each one has a step that settles it:

- The TypeScript parser for the Bun source counters, and its size
  in the bundle (step 5).
- The child transport on Deno (step 8).
- Hang reports on Bun and Deno (steps 5 and 8).
- Retention limits for the store, against real project sizes
  (step 2).
