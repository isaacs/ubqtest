# Decisions

One entry for each decision. Each entry states the decision, who
made it, and the reason. Add new entries at the end. If a decision
changes, edit its entry and state the new date.

## D1. Coverage is always on (user, 2026-11-11)

Per-test coverage runs in each test run. There is no option to
turn it off.

**Reason.** Deep insight into test behavior is not possible without
it. Slowness is a cost, but it is not the only cost.

**Result.** The speed goal stays. We make coverage as fast as we
can, and we get speed from other parts of the system to pay for
it. Coverage cost needs a measurement early, so that the design of
the other parts can account for it.

## D2. Strict rules, no opt-out at the start (user, 2026-11-11)

The tool has one correct way to do each thing. Examples: a test
with zero assertions fails, there is no `.only`, and zero matched
tests is an error. We add flexibility later only if a real need
shows up.

**Reason.** Agents adapt to rules more easily than humans do, and
they do better work when the correct way is not in doubt.

## D3. The guardrails must work for weaker models (user, 2026-11-11)

The design must help older and lower-powered models do the right
thing, not only frontier models.

**Result.** These rules apply to each feature:

- The tool must not depend on the agent to remember a step. The
  safe behavior is the default behavior.
- Each failure and each error prints the next command to run.
- There is one way to do each thing, so that there is no wrong
  choice to make.
- The output states the result in plain words. The agent must not
  have to infer a failure from missing text.
- A mistake must fail loudly and early. A silent wrong result is
  the worst outcome.

## D4. Wire format: one event stream, many sinks (agent, 2026-11-11)

The user left this decision to the agent, with one constraint: in
CI, stdio is often the only thing that a person or an agent can
read.

**Decision.**

- The test library produces typed events: run start, test start,
  assertion, console output, coverage, test end, run end. The
  event types are the wire format. They have a version number.
- In the test process, the library publishes each event on a
  `diagnostics_channel` channel. Sinks subscribe to the channels.
- A sink is one consumer of the events. The planned sinks are:
    - **Database sink.** Writes the run to SQLite.
    - **Compact text sink.** The default on stdout. Prints nothing
      for a passing test, one block for each failure, and one
      summary line.
    - **CI text sink.** See below.
    - **Event dump sink.** Writes the raw events as one JSON
      object for each line. This is the debug tool for the wire
      format itself.
- When a runner starts test processes, each child sends its events
  to the runner, and only the runner writes to the database.
  SQLite permits one writer at a time, so many writer processes
  would wait on each other.
- When a test file runs as a plain program (`node test/foo.ts`),
  the process is its own runner. The same sinks run in that
  process.
- TAP is not the wire format. A TAP sink can be added later, since
  the events contain all the data that TAP needs.

**Reason.** TAP is text that a consumer must parse again, and it
has no standard place for coverage, console capture, or handle
data. Direct database writes from each test process are hard to
debug and make the processes wait on the database lock. An event
stream keeps the data typed from the test to the sink. It also
gives one extension point for reporters, as `node-tap` and
`node:test` do with their lower layers.

**CI behavior.** When the tool detects CI (assumption: the `CI`
environment variable, as most CI systems set it), stdout must be
enough to debug with no database. The CI text sink adds to the
compact output, for each failure:

- the captured console output of the test
- the full diff, not the short one
- the hang report, if the test timed out
- the seed, the runtime version, and the platform

It still prints nothing for a passing test. The run also writes
the database file, so that a CI job can keep it as a build
artifact and a developer can query it on a local machine.

**Not decided.** The transport from a child process to the runner
(Node IPC, a pipe with JSON lines, a binary format, or worker
thread messages). This needs a measurement.

## D5. Coverage method: V8 precise coverage with counts (agent, 2026-11-11)

The collector uses `Profiler.startPreciseCoverage` with
`callCount: true, detailed: true`, and takes a snapshot at each
test end.

**Reason.** It is the only V8 mode that gives correct data for each
test (`03-measurements.md`, section 2.1). It needs no source
transform.

**Result.** Tests in one process run one at a time, because a
snapshot cannot split the coverage of two tests that overlap.

## D6. Transport: JSON lines on fd 3 (agent, 2026-11-11)

A child writes its events as JSON lines to file descriptor 3, with
one sync write at each test end. Only the runner writes to the
database. This settles the open point in D4 for Node and Bun. Deno
needs a different method.

**Reason.** All methods have the same speed (`03`, section 6). A
sync write of plain text is the simplest one to debug, and it
cannot be lost after the write returns.

## D7. Async tracking is off in a normal run (agent, 2026-11-11)

Hang reports use the handle list and an inspector stack probe from
the runner. The `async_hooks` init hook runs only when the tool
runs a timed-out test again.

**Reason.** The init hook makes await-heavy code 5 times slower
(`03`, section 8).

## D8. No result cache in the first version (agent, 2026-11-11)

The tool does not skip a test because its inputs look unchanged.
`--changed` is the only mode that leaves tests out, and the user
asks for it by name.

**Reason.** A wrong cache hit reports a pass that did not happen.
That is the worst outcome under D3.

## D9. One process for each test file (user, 2026-11-11)

This is the only isolation mode in the first version. It is the
same choice that tap made. Worker threads and shared processes are
faster and isolate less. They can come later as options.

## D10. Bun support through source counters (user, 2026-11-11)

Bun is a required platform. It grows fast in agent workflows. Bun
has no usable API for per-test coverage, so the Bun collector adds
counters to the source (`04-architecture.md`, section 4). When that
works, a separate project can send patches to Bun for a real API.

## D11. The speed goal (user, 2026-11-11)

Go as fast as possible, so that CI timeouts stop and the edit-test
loop feels immediate. `bun test` is a very high bar, and it is
acceptable not to reach it.

## D12. Minimum runtime versions (user, 2026-11-11)

Set the minimum version that the wanted features need. Do not
give up a feature to support an old version. The current minimum
is Node 24.

## D13. Name and package shape (user, 2026-11-11)

The package is named `ubqtest`. The executable is named `ubq`
(each letter of `tap` plus 1). The user changed the package name
from `ubq` on 2026-11-11, because `ubq` is too close to the names
of existing packages. Test files import from `'ubqtest'`. The state
folder is `.ubq/`. The source can have as many logical parts as it
needs. The end state is one package, a small bundle, and no
dependencies.

## D14. Hang reruns are a switch, on by default (user and agent, 2026-11-11)

The user asked for a config switch and left the default to the
agent. The default is on: the runner runs a timed-out test again
with async tracking, up to 3 tests for each run.

**Reason for the default.** D3: the tool must not depend on the
agent to remember a step. The extra wait applies only to a run
that already has a timeout failure.

## D15. No `t` object, free assertion functions (user and agent, 2026-11-11)

Test files import `test`, `describe`, and `assert`. The test
function receives only `{ signal }`. See `05-api.md`.

**Reason.** Tap had `t` to carry test state before the language had
promises. `AsyncLocalStorage` does that job now. Imported assertion
functions can narrow types, and methods of a callback argument
cannot.

## D16. No subtests inside a test (user and agent, 2026-11-11)

`describe` is the only grouping. It adds a name prefix and options.

**Reason.** Subtests help humans, but they lead coding agents to
overcomplicate tests, most of all when the context window is full.

## D17. Zero assertions is a failure, with no opt-out (user, 2026-11-11)

**Reason.** It removes a full class of uncertainty and of wrong
passes.

## D18. `testdir` folders stay after a failure (user, 2026-11-11)

A `testdir` folder is removed when its test passes. It stays when
the test fails. Its path comes from the test ID, under
`.ubq/testdir/`, so that one `.gitignore` line covers it and an
agent can predict it.

## D19. One name pattern for test files (agent, 2026-11-11)

A test file has a name that ends in `.test.ts`, `.test.mts`,
`.test.cts`, `.test.tsx`, `.test.js`, `.test.mjs`, `.test.cjs`, or
`.test.jsx`. `ubq` with no arguments runs all such files in the
project, outside `node_modules` and outside folders whose names
start with a dot. A file of any name runs if it is an argument.

**Reason.** One rule (D2). `.test.` is the name that Vitest, Jest,
and Bun users already write. A folder rule (`test/`) would also
match helper files and fixtures.

## D20. The run number is in the summary line (agent, 2026-11-11)

Runs have numbers that count up in each project store: `(run 42)`.
A number is short to type in `ubq failures 42`.
