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

## D21. Parser for source counters: acorn with a TypeScript plugin (agent, 2026-11-11)

The instrumenter uses `acorn` and `@sveltejs/acorn-typescript`.
Both are development dependencies. The build puts them into
`dist/bun-preload.js`, so the package has no dependencies at
install time (D13). Only a Bun test process loads that file.

**Reason.** The counters go into the original TypeScript text, and
Bun compiles the result. This needs positions in the original
source and no code generator. Parsers that are native modules
cannot go into one bundle.

## D22. The instrumenter is separate from Bun (agent, 2026-11-11)

`src/instrument.ts` takes source text and returns changed text and
regions. It knows nothing about Bun. Only `src/bun-preload.ts` uses
the Bun plugin API.

**Reason.** Source counters could replace V8 snapshots on Node
later (`04-architecture.md`, section 12). A snapshot of counters
costs microseconds, and a V8 snapshot costs 0.43 ms for each test.

## D23. A folder with its own `package.json` is a different project (user and agent, 2026-11-12)

The search for test files does not go into a folder that has its
own `package.json`. At the root of a monorepo, `ubq` runs only the
tests of the root.

**Reason.** ubq already takes the nearest `package.json` as the
project, and each project has its own store. With no rule, a
repository with experiments, fixtures, or packages runs tests that
are not its own. This repository had that fault.

## D24. Configuration is the `ubq` key of `package.json` (user, 2026-11-12)

As little configuration as possible. The keys are `include`,
`exclude`, and `timeout` (`08-config.md`). There is no config file.

**Reason.** `package.json` is already the mark of a project for
package managers, and ubq reads it in any case. Some users do not
like tool fields in `package.json`. That is acceptable if the
field is small and only projects with special layouts need it.

## D25. Source counters on Node, with V8 as the reference (user and agent, 2026-11-12)

Node gets source counters in three steps:

1. Build the cache and a Node preload. Done:
   `ubqtest/counters-preload`.
2. A test in this repository compares the answers of counters and
   V8 on a fixture project, and fails on a difference that is not
   in its list of accepted ones. Done: `test/counters.test.ts`.
3. Switch the runner to counters. Done (2026-11-12): the user
   chose to switch now, because the cost of V8 coverage is high
   and a switch back is possible. `UBQ_COVERAGE=v8` makes the
   runner use the V8 collector.

V8 stays the reference in `test/counters.test.ts`. A plain `node
file.ts` has no preload, so it stays on V8.

**Reason.** Counters are faster (`03-measurements.md`, section
12). The user's experience with `nyc` and `istanbul` was that
source counters were flaky. A new instrumenter must earn trust
against a method that is known to be correct.

## D26. `--baseline` hides failures in the text, not in the result (agent, 2026-11-12)

`ubq --baseline <commit>` runs the tests of the commit in a clean
checkout, and then the tests of the working tree. The text shows
a failure block only for a failure that the commit does not have.
The other failures are a list of test IDs. The summary line, the
exit code, and the store have all the failures.

The checkout is a git worktree in `.ubq/baseline/` of the project.
It is removed after the run. The baseline runs each time: its
results are not kept for the next command.

**Reason.** A test that fails is a failure, also when it failed
before (D2). An exit code of 0 for "no new failures" would let an
agent stop while the suite is red. The line `baseline ...: 0 new
failures` is the answer to "did I break this?". The checkout is in
the project so that its code finds the `node_modules` of the
project, with no install step and no links. No kept results, for
the reason that `04-architecture.md`, section 6, gives for the
result cache: a kept result that is wrong hides a difference.

The user accepted these points (2026-11-12).

## D27. A run record has the git commit, not the state of the tree (user, 2026-11-12)

Each run record has the hash of the commit that is checked out.
ubq reads it from the files of git, with no `git` process. The
record does not say if the tree had changes.

**Reason.** `git status` takes 5 ms or more, and the budget for a
run of one file is 58 ms. The digest of the loaded code
(`test.code`) already tells if two runs ran the same code.

## D28. Test files run in a random order. Tests in a file do not (user, 2026-11-12)

The runner starts the test files in a random order. The seed is in
the run record, and a run with a failure prints it. `ubq --seed
<n>` gives the order of that seed. The tests of one file run in
the order of the file.

**Reason.** A fixed order of files hides a test file that depends
on a different file. A random order of the tests in a file is a
common source of confusion for people who read the file.

**Result.** The runner no longer starts the slowest files first.

## D29. A test must put back the environment and the working directory (user, 2026-11-12)

A test that ends with a different `process.env` or a different
working directory fails (kind `leak`). ubq puts the old values
back, so that the next test is not affected. There is no check
for globals and no check for listeners.

**Reason.** The cost (0.1 to 0.25 ms for each test) is not
material. Libraries set globals and add listeners at their first
call, so a check for these would fail tests that did nothing
wrong.

## D30. The fake clock is an object that belongs to its test (user, 2026-11-12)

`fakeClock()` returns a clock object for the current test. The
object has a method that ends it (`restore`), and it ends with the
test. It takes over all the timers and clocks that it can.

**Reason.** A test contains all that it needs (`05-api.md`,
section 2), and nothing needs a reset in the next test. A clock
that takes over only some functions gives code that is half in
fake time, which is hard to understand.

## D31. Snapshots: `assert.snapshot`, one file for each test file, explicit update (user, 2026-11-12)

D76 changes this decision: `ubq --update` with no test writes all
snapshots.

`assert.snapshot(value)` compares with saved text. Each test file
has one snapshot file, as in tap. Only `ubq --update` with the
names of tests writes it.

**Reason.** The user's experience with tap: this design did not
have to change much. An update with no list of tests accepts
changes that nobody looked at (`01`, section 7).

The agent chose the place (`ubq-snapshots/<test file path>.snap`,
as `tap-snapshots/` in tap) and the form of the file.


## D32. The build makes the package in `dist/`, and the package is published from there (agent, 2026-11-12)

`npm run build` writes all files of the published package to
`dist/`: the bundled and minified JavaScript, the type declarations
(`types/`), and a `package.json` whose `exports` and `bin` name the
built files. `npm publish ./dist` publishes it.

**Reason.** In this repository, `ubqtest` must resolve to the
source (`src/index.ts`), so that the tests run with no build. Node
does not strip types from a file in `node_modules`, so the
published package must name JavaScript files. One `package.json`
cannot do the two jobs. `test/package.test.ts` builds the package
into a new project and uses it there.

## D33. Coverage on Deno is source counters only (agent, 2026-11-12)

On Deno, the V8 collector is off. The runner gives each Deno test
process the counters preload. A plain `deno run -A test/foo.ts`
records coverage `none`, as on Bun.

**Reason.** Deno compiles TypeScript to JavaScript with different
positions, and V8 coverage on Deno has the positions of that
JavaScript. `ubq uncovered` printed wrong lines for a plain Deno
run of the coverage fixture (`'A' (+2 lines)` at `src/calc.ts:5:12`
in place of `return 'fail'` at `8:3`). Counters have the positions
of the source on all runtimes.

## D34. No worker threads and no shared processes. Order of the later work (user, 2026-11-12)

ubq will not run test files in worker threads or in shared
processes. One process for each test file stays the only mode (D9).

**Reason.** These modes have too many edge cases, and the goal is
that the tool is correct with no setting. A mode that is faster
and can leak state between files is against that goal.

The order of the later work is: per-test coverage on Bun, then
mutation checks, then the background server.

## D35. The mutation check: changes in the test process, exit code 0 (agent, 2026-11-12)

`ubq mutate <file>` makes one small change to the file at a time,
runs the tests that ran the changed code, and lists each change
that no test failed for.

- **The file on disk does not change.** The load hook of each test
  process makes the change (`UBQ_MUTANT`). A check that stops in
  the middle leaves nothing to put back, and two agents in one
  project do not see changes of each other.
- **The check does not write runs to the store.** A failure there
  is not a failure of the project.
- **The exit code is 0, also with survivors.** Some changes cannot
  make a test fail, because the changed code does the same thing
  (a change of `<` to `<=` in a loop over an array with one more element at its end). An exit code of 1 would tell an
  agent to "correct" code that is correct. The summary line has
  the count.
- **A test file runs one change at a time.** Two processes of one
  test file can fail only because they run at the same time (a
  port, a `testdir` folder). Different test files run at the same
  time.
- **The time limit of a test is 10 times its last time, and 1000
  ms or more.** A change can make a loop that does not end.

The command needs the name of a file. A check of all files of a
project can take a long time, and the agent knows which file it
changed.

## D36. The background server gives out test processes. It does not run tests (agent, 2026-11-12)

`ubq server` keeps test processes that are started, and prepares
the counters of files that change. The runner stays the process
that the user started. `11-server.md` has the design.

**Reason.** The plan requires the same command, output, and exit
code with and without the server (`01`, section 13). If the
runner is the same code in the two cases, that is true by
construction. A server that runs the tests itself needs a runner
that can serve many requests in one process, with the working
directory, the environment, and the configuration of each
client. Each of those is a place for a difference.

The server does not watch files to run tests before the user
asks. A result from before the command is a cached result, and D8
does not permit one.

The server does not start by itself.

## D37. No MCP interface and no HTTP interface (agent, on a question from the user, 2026-11-12)

The interface for agents is the command and its text. The reasons
are in `11-server.md`. The user asked the agent to consider MCP
and HTTP, and can overrule this.

## D38. Each run of a TypeScript project checks the types (user, 2026-11-12)

A project is a TypeScript project if it has `tsconfig.json` in its
root and the `typescript` package. Each run of its tests also runs
`tsc --noEmit --incremental`, at the same time as the tests. There
is no option that turns the check on or off. A type error fails
the run with exit code 1, the same as a failed test.

The checker keeps its data for the next run in `.ubq/types/`.

**Reason.** A test tool that does not check types lets a wrong
type through until a different tool finds it. The cost is small:
TypeScript 7 checks this project in 40 ms with the data of the run
before. A run of all files takes no more time. A run of one small
file takes 82 ms, and 51 ms with no type check.

This is the answer to Q7.

## D39. Bun coverage: an issue to Bun, and inspector coverage as an option (user, 2026-11-12)

The answer to Q8 has two parts.

1. The proposal of `10-bun-coverage-api.md` is an issue on the Bun
   project. The agent does not work on a patch for Bun until the
   Bun project accepts the issue. The user tells the agent when to
   look.
2. `"bunInspectorCoverage": true` in the `ubq` key turns on
   inspector coverage for a test file that runs as a plain program
   on Bun. It is off by default, because it can record more
   coverage, but cannot be correct in all cases.

How part 2 works (`src/bun-coverage.ts`): the transpiler of Bun
with `target: 'bun'` makes almost the same JavaScript as the Bun
runtime. The collector matches the words of that JavaScript with
the words of the source, and changes each offset with the match.

What it gives, measured on Bun 1.4.3:

- Each file that a test ran is in the store, so `--changed` is
  correct.
- Functions with a branch get ranges, on the correct line in the
  samples.
- A function with no branch can be absent.
- The blocks of class methods got places in different functions
  of the same file.
- A `.tsx` or `.jsx` file gets only a mark that it ran.
- Code that never ran is not listed, so `ubq uncovered` is not
  complete. The mode of the test file is `partial`.
- With `NODE_COMPILE_CACHE` set, Bun gives no ranges for code
  that comes from the cache, so the second run records nothing.

Under the runner, all coverage comes from counters, with or
without the option.

## D40. JSX files get counters: in the source on Bun, in the compiled JavaScript on Deno (agent, on a request from the user, 2026-11-12)

The user asked for coverage of `.tsx` and `.jsx` files with no
setup, and permitted experiments.

**Bun.** The parser of ubq has a JSX mode. The counters go into
the JSX source, as for a `.ts` file, and Bun compiles the result.
A counter is an expression, and each expression of JSX is in
`{...}`, so no new rule was necessary.

**Deno.** Deno compiles a file before a load hook sees it, and the
hook must return JavaScript. Three options:

1. Counters in the source, then a JSX compiler in ubq. ubq has
   none, and one in the package is a large dependency.
2. Counters in the JavaScript of Deno, and the inline source map
   of Deno for the places. **Chosen.** It needs a reader for
   source maps (60 lines) and no dependency.
3. No coverage for JSX on Deno.

Option 2 is less exact than counters in the source. A source map
has the start of each token, not the end of a region. So a region
ends at the end of its last token that is in the map. The lines
were correct in the checks.

A mutation check needs a change in the source before the compile
step, so `ubq mutate` of a JSX file on Deno is an error.

**Node** does not run JSX. A project can add a load hook that
compiles it. Option 2 could work there too, if that hook gives an
inline source map. This is not built and not tried.

## D41. Commands that work on a change: `--changed` by range, and `--diff` (agent, on a request from the user, 2026-11-12)

**`ubq --changed` selects tests, not test files.** The store keeps
the content of each file that has coverage, under its hash
(`.ubq/sources/`). `--changed` finds the part of a file that is
different (the text between the equal start and the equal end of
the old and the new content), and selects the tests that ran a
range in that part.

- A test file runs all its tests if the changed code ran while
  the file loaded, if the test file changed, or if its coverage
  is not `full`.
- A test that did not run the changed part does not run. Its
  coverage in the store gets the places of the new content, so
  `ubq covers`, `ubq uncovered`, and `ubq mutate` stay correct.
- Two changes in one file give one part, from the first change to
  the last. That selects more tests, never fewer.

**Reason.** A test that ran none of the changed code takes the
same path through the same code, so its result is the same. The
type check of the run finds a change that is only in types.

**`--diff` is the difference from a git commit.** `ubq uncovered
--diff` and `ubq mutate --diff` use the lines of `git diff -U0`,
and all lines of a file that git does not have. `--diff` is
`HEAD`. `--diff=<commit>` names a different commit. These
commands start `git`. A run of tests does not.

`ubq uncovered --diff` also lists each changed file with code that
no test loads. Its exit code is 0, as for `ubq uncovered` and
`ubq mutate` (D35).

## D42. An import of `./a.js` finds `./a.ts` (agent, 2026-11-12)

Much TypeScript source imports `./a.js` for the file `./a.ts`,
because that is the name after a build. Bun finds the file. Node
and Deno do not. The preload of the runner has a resolve hook: if
a relative import that ends in `.js`, `.mjs`, `.cjs`, or `.jsx`
names no file, the hook tries `.ts` (then `.tsx`), `.mts`, `.cts`,
or `.tsx`.

**Reason.** A project that moves to ubq must not have to change
each import of its source first (D24: as little configuration as
possible, and the tool guesses correctly).

A test file that runs as a plain program on Node (`node
test/a.test.ts`) has no preload, so it needs the `.ts` names.

## D43. Conversion from a different test tool: a command, a guide, and a skill (agent, on a request from the user, 2026-11-12)

Three parts, each for a different kind of work:

1. **`ubq convert <files or folders>`** makes the changes that
   are certain: imports, `it` to `test`, assertions with one form
   in ubq, `t.end()`, `await` for `rejects`. It knows tap,
   `node:test` with `node:assert`, vitest, jest, and mocha with
   `node:assert`. For each statement that needs a decision, it
   writes a `// TODO(ubq): ...` comment with the instruction, and
   lists it in its report. Source: `src/convert.ts`.
2. **`ubq guide convert`** (`CONVERT.md`) has the steps of a
   conversion, the tables of forms, the cases that need a
   decision (hooks, subtests, module mocks, loose comparisons),
   and a table of the failures that come after a conversion, with
   the cause of each.
3. **The `use-ubq` skill** (`skills/use-ubq/SKILL.md`, and `ubq
   skill` to copy it into a project) tells an agent to read the
   two guides of the installed package, and gives the order of
   the work. `ubq skill` writes to each `.<name>/skills` folder
   that the project has, and to the folder of the agent that runs
   the command, which it knows from the variables that the agent
   sets (the list of pnpm). With none, it writes to
   `.claude/skills`. `ubq skill <agent or folder>` writes only
   there (user, 2026-11-13).

**Reason.** A program does the certain changes faster and with
fewer errors than an agent. An agent does the changes that need
the sense of the test. The guide is in the package, so it is
correct for the installed version, and an agent with no skill
system can read it with one command.

The command changes files in place and does not make a copy: the
project is in git. It reads the result with the parser before it
writes, so it does not write text that is not code.

Not built: chai, sinon, ava, tape, jasmine.


## D44. The web site is a static build from the documents (agent, 2026-11-12)

`npm run site` (`scripts/site.ts`) makes the site in `_site/`.
The folder is not in git.

- The home page is `site/home.html`. The style is in
  `site/static/`. It follows node-tap.org: a light gray ground,
  a white bar at the top, rings behind the title, round buttons,
  and the same heading font.
- Each document page comes from a markdown file of the
  repository. The list is `PAGES` in the script. A new document
  needs one row there.
- Each page has a markdown copy at `<page>.md`. `llms.txt` is the
  index for agents. `llms-full.txt` has the user documents in one
  file.
- Each link is relative, so the site works at any URL.
- In the HTML, a path in code text is a link. A document of the
  site goes to its page. A different file or folder that git
  tracks goes to the repository on GitHub.
- In the HTML, the number of a decision (D14) is a link to the
  heading of that decision. Not in a heading, and not in code
  text.
- The page has no script. `marked` makes the HTML. The colors of
  code come from a small function in the script.

**Reason.** The documents are already the source of `ubq guide`
and the README. A site that is made from the same files cannot
say something different. An agent reads markdown with fewer
tokens than HTML.

Not built: search. The upload to a host is D46.

The site is at `https://ubq.dev`. Each page has that address in
its link preview tags (`og:url`, `og:image`), because a preview
needs full URLs. The image is `site/static/logo-1200x630.png`
(the middle of `logo-1200x1200.png`, in the shape of a wide
card). All other links of the site stay relative.

## D45. Front-end tests: Playwright with Chromium, one function (user and agent, 2026-11-12)

`import { browser } from 'ubqtest/browser'`. `await browser()`
gives a `Page` of Playwright in a new context. The answers of the
user to Q9 set points 2, 3, and 5.

1. **Driver: Playwright (`playwright-core`), with the Chromium
   headless shell.** Agents know its API, so they guess less. It
   works on Node, Bun, and Deno (`03-measurements.md`, section
   13). It is an optional peer dependency: the browser is a
   100 MB download for each system, too large for the package.
2. **The user says what runs.** `ubq` has no opinion on the
   server. With no configuration, `page.goto('/path')` loads a
   file of the project from the disk, through a route of
   Playwright at `http://project.localhost/`. A page from a
   `file:` address cannot load a module script, and this address
   can. With `browser.url`, the path is from that URL. With
   `browser.command`, the runner starts the server if a test file
   of the run uses the browser and nothing answers at the URL.
3. **The download is a command: `ubq browser install`.** A test
   run does not download. The version of the browser is the
   version that the `playwright-core` of the project needs.
   `PLAYWRIGHT_BROWSERS_PATH` sets the folder (a variable of
   Playwright). `UBQ_BROWSER` is the path of a program to use in
   place of the download.
4. **A browser for each test file, a context for each test.** The
   browser is a separate server process (`launchServer` of
   Playwright). The cleanup functions of the file kill it. On
   Windows, on a machine with much work, Playwright took more
   than 5 seconds to stop the browser and remove its folder, and
   ubq then reported a cleanup that did not end. So ubq kills the
   process itself first, and that cleanup has a limit of 60
   seconds.
5. **The API is the `Page` of Playwright, plus one assertion.**
   `assert.eventually(fn, pattern)` is `assert.match` for a value
   that changes with time: it calls `fn` until the value matches,
   for 2000 ms at most. It is in the core API, because it is also
   correct for other async code. ubq adds no names for the page.
6. **An error that the page does not catch fails the test.** A
   `console.error` of the page does not: a test of an error path
   gets one from the browser for each failed request.
7. **An action has a limit of 2000 ms**, not the 30 seconds of
   Playwright, so the failure comes before the time limit of the
   test and names the element.

Coverage of code that runs in the browser is D47. Not built:
Firefox and WebKit. A
compile step for TypeScript that a static page loads.

A fault of Deno 2.9.6 that this work found: with a load hook, a
JSON file that `require` loads has no format, and Deno reads it as
JavaScript. The load hook of the counters sets the format.

## D46. The site is a Cloudflare Worker, deployed by a workflow that the maintainer starts (user, 2026-11-12)

The host is a Cloudflare Worker with only static files.
`wrangler.jsonc` names the Worker (`ubqtest-site`) and the folder
`_site/`. A missing address gets `404.html` with status 404.

`.github/workflows/site.yml` makes the site and runs `wrangler
deploy`. It starts only by hand (`gh workflow run site.yml`). Its
environment is `site`, with the secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`.

**The site and npm.** The release workflow does not publish: a
maintainer approves the staged version later. A deploy in that
workflow would put the site ahead of npm. So the deploy is a
separate step of the release, after the approval. With no input,
the workflow reads the version that npm has and makes the site
from the tag of that version. The input `ref` names a different
tag or branch.

Checked with `wrangler deploy --dry-run` and `wrangler dev`: the
pages, the markdown copies (`text/markdown`), `llms.txt`, and the
404 page. A real deploy is not tested.

## D47. Coverage of code that runs in a page (user and agent, 2026-11-12)

The `Page` that `browser()` gives records coverage in Chromium
(`page.coverage` of Playwright). When the test ends, the ranges of
each script go into the `coverage` event of the test, with the
ranges of the test process. The store and the commands do not
know the difference.

- **The file of a script** is the file at the path of its URL,
  from the project root. The URL must start with `browser.url`,
  or be a file that ubq gave to the page.
- **The script is the file:** the positions are the same.
- **A server made the script from the file:** the script must end
  with a source map that has one source. `src/source-map.ts`
  changes the ranges to positions of the file. This is the case
  of a development server that compiles each module (Vite).
- **No coverage:** a bundle of many files, a script with a source
  map in a separate file, a script in the text of the HTML, a
  file in `node_modules`, and a page that the test did not get
  from `browser()` (a popup).
- If the test process and a page run the same file, the counts
  are added (`mergeRanges` in `src/coverage.ts`).

**Reason.** A browser test with no coverage cannot be selected by
`--changed`, and `uncovered` lists all front-end code. The data
is there in Chromium at almost no cost.

A defect that this work found: under `ubq` on Node, a function
that a test gave to `page.evaluate` had counters of the test file
in its text, and failed in the page (`__ubqc is not defined`).
Each page now has an object with that name that keeps nothing.

## D48. Tests of a Cloudflare Worker run in workerd (user and agent, 2026-11-13)

A test file that the `workers` key of the configuration selects
runs in workerd, the runtime of Workers, with the local bindings
of a wrangler config. The user decided the four points of Q10:
the config key, a small `ubqtest/workers` module with new names,
no `preload` key, and a first version with known limits.

- **The config key:** `"workers": [{ "config": "wrangler.jsonc",
  "include": ["test/**/*.test.ts"] }]`. ubq does not find Workers
  tests from the text of a file: a test file that imports only
  source can need workerd too.
- **The process:** the runner starts `node workers-host.js <test
  file>` in place of the test file (`src/workers-host.ts`). The
  host is the test process for the runner: the same variables,
  the same event pipe, the same process group. It always runs on
  Node, also if the runner is Bun or Deno, because wrangler
  needs Node. One host and one workerd for each test file, so
  each file has its own storage.
- **The bindings:** from `unstable_getMiniflareWorkerOptions` of
  the `wrangler` package of the project, given to `miniflare`,
  which wrangler depends on. `wrangler` is an optional peer
  dependency of ubqtest.
- **Modules:** workerd asks the host for each module that it does
  not have (the module fallback service). The host reads the
  file, adds the source counters, and removes the types. It finds
  files as a bundler does (`./a` and `./a.js` for `a.ts`), and
  packages with the conditions `workerd`, `worker`, `browser`.
  The `alias` key of the wrangler config applies. There is no
  bundle step.
- **A CommonJS file is two modules.** workerd gives a CommonJS
  module only a default export, and many ES module packages import
  names from a CommonJS package (`13-agent-feedback-0.0.4.md`,
  item 1). `import` of the file gets an ES module with the named
  exports, which `cjs-module-lexer` finds as Node does. That
  module imports the file itself, which has a second name
  (`<path>.ubq.cjs`). `require` gets the file itself. The default
  export is `module.exports`, as on Node.
- **Vars:** the `vars` of the wrangler config, then `vars` of the
  `workers` entry. Not `.dev.vars` and not `.env`: wrangler reads
  them for `wrangler dev`, and they can have real secrets.
- **A service binding to a Worker that is not in the run** gets a
  function that answers 503. With no such function, workerd does
  not start.
- **Containers** are off (`enableContainers: false`): a container
  needs an image, and a test run builds none.
- **The binding for events** (`__UBQ_HOST`) is removed from `env`
  before the test file loads, so the tests see only the bindings
  of the Worker.
- **The main module of the Worker** is an export of the module
  that workerd starts, so the classes that the config names
  (Durable Objects, Workflows) exist.
- **The test API** is the same code (`src/index.ts`). A global
  (`src/workerd.ts`) tells it that it is in workerd. It gets the
  project root and the configuration from the host, because
  workerd has no file system.
- **The body of the test file runs in a function.** workerd does
  not let a module do I/O while it loads, and a test file does
  that at its top level (`await migrate('DB')`). The host puts
  the code after the last `import` of the test file in a
  function, with no change to line numbers, and the entry module
  calls it in its request. A test file with an `export` is not
  changed.
- **Events** go from workerd to the host in a request that
  workerd waits for, before each test starts and when the file
  ends. So the runner knows that a test started before the test
  can block the thread. A response stream did not give that.
- **Coverage:** workerd sends the counts. The host has the
  regions, and makes the ranges.
- **`ubqtest/workers`:** `executionContext()` (with `settled()`),
  `scheduledController(options)`, and `migrate(binding)`. `env`
  is the export of `cloudflare:workers`, not of ubq.
- `ubq` adds the `nodejs_compat` flag, because the test API uses
  modules of Node.

**Limits of the first version** (the user accepted them as known
gaps): `testdir`, `mockImport`, and `assert.snapshot` throw in
workerd. A timeout has no list of open things and no hang rerun.
A stuck test has no stack. No JSX files. A CommonJS package gives
only its default export (corrected after the first report: see
"A CommonJS file is two modules"). No `SELF` fetcher, and no
storage for each test. A module that the test file imports
cannot do I/O when it loads: workerd does not permit it, also
after an `await` and also for a promise that the request
resolves. `fakeClock` does not replace the names of
`node:timers`.

**Reason.** The report in `12-agent-feedback-0.0.3.md`: a Workers
project could not convert. Workers are a common place to run
code, and the tests of a Worker are worth most in the real
runtime: they find the
differences from Node. A run on Node with stubs does not. The
trial (`03-measurements.md`, section 14) showed that workerd can
load the files and run the test API with little new code.

**Not chosen:** a `preload` key for a Node hook that maps
`cloudflare:workers` to a stub (the tests would run on Node);
the name `cloudflare:test` answered by ubq (it would promise the
whole API of the vitest plugin); code that runs through an eval
binding, as the vitest plugin does (more code, and positions that
need maps).

## D49. The type check covers each tsconfig of the run, and a selection fails only for its own files (user, 2026-11-13)

Two changes to D38, from three reports of one conversion
(`14-agent-feedback-0.0.5.md`, item 6). The user chose both from
Q11.

- **Each config.** The runner starts the checker for the
  `tsconfig.json` of the project root, and for each
  `tsconfig.json` in a folder from a test file of the run up to
  the root. The checkers run at the same time. An error that two
  of them report shows one time. Each config keeps its own data
  in `.ubq/types/`.
- **A selection.** A run is a selection if the command names
  files, lines, or IDs, or has `--changed` or `--failed`. Such a
  run reports the type errors of the files that it used: its test
  files, and the files in its coverage events. An error with no
  file is always reported. The others are one line with their
  count (`otherTypes` in the `run-end` event). They are not
  events, they are not in the store, and they do not change the
  exit code. A run of all tests does not change: each type error
  fails it.

**Reason.** With one config, ubq said that a project had 12 type
errors when it had 17: the second Worker has its own config. An
agent that trusts the last line then reports a clean result that
is not clean. And in a run of one file, the errors of files that
the agent has not reached yet hid the result of the file, and
made each run end with `fail`.

**Cost.** A file that only has types (no code that a test runs)
is not in the coverage of a run. Its errors show in a selection
only through the files that use those types, and in a run of all
tests.

## D50. `isDeepEqual` is an export (user, 2026-11-13)

`isDeepEqual(a, b)` gives true or false by the rules of
`assert.deepEqual`. It is not an assertion, and it does not count
as one in a test.

**Reason.** "The list has an element that equals this value" had
no form in ubq (`toContainEqual` of jest and vitest). Three
reports asked for it. One name covers that case, `not`, and
`arrayContaining` with objects:
`assert(list.some(item => isDeepEqual(item, expected)))`. `ubq
convert` writes that line.

**Not chosen:** a form of `assert.match` for an element of an
array. It covers one case, and it changes what a pattern means.

## D51. A test helper is not code of the program (user and agent, 2026-11-13)

A test helper is a file that is part of the tests and is not a
test file: a setup module, or the scenario of an end-to-end test
that starts the environment for the tests.

- **Which files.** With no configuration: each file in a folder
  with the name `test`, `tests`, or `__tests__`, at each depth.
  The `helpers` key of the configuration is a list of glob
  patterns that replaces this rule. An empty list means that no
  file is a helper.
- **`ubq uncovered`** leaves helpers out, also with `--diff`. The
  summary line has their count. A file that the command names is
  in the list in each case.
- **`ubq uncovered` exits with 1** if it lists code, or a changed
  file that no test loads. A project can use it as the check for
  full coverage.
- **`ubq mutate --diff`** does not change a helper. `ubq mutate
  <file>` with a helper as the argument does.
- **No change:** coverage of a helper is recorded. `ubq --changed`
  runs the tests that loaded a helper that changed, and `ubq
  covers` answers for its lines.

**Reason.** A project that wants full coverage reads the list of
`ubq uncovered` as work to do. With helpers in the list, an agent
writes tests for the tests, and then tests for those. The user
had to stop an agent in that loop. The scenario of an end-to-end
test is part of the test, and its coverage has no use.

**Why a default.** The agents that go into that loop do not know
that a key exists. The folder names cover the common layout. A
project with code of the program in a folder named `test` sets
the key.

**Not chosen:** to find helpers from the code (a file that
imports `ubqtest`, or a file that only test files import). A
setup file often imports nothing from ubq, and ubq has no import
graph.

## D52. The files of ubq are project files in the repository of ubq (user, 2026-11-13)

The collectors left out each file in the folder of the library.
That rule is gone. A file of ubq is not a project file for a
user: it is in `node_modules`, or outside the project root
through a link, and both were left out before this rule. In the
repository of ubq the files are in the root, so they have
coverage now. This is the rule of tap: its own files count only
in its own project.

Failure reports still leave out the stack frames of the library,
in each project (`src/stack.ts`).

The parser is a project file here, and the load hook gets it
while the hook loads the parser. For that time the hook gives no
counters (`loadingParser` in `src/counter-collector.ts`).

**Reason.** ubq must be able to check its own tests with `ubq
uncovered`. The rule did not protect a user from the sources of
ubq: the two older rules do that.

**Not complete.** Most of ubq runs in child processes of its
tests (`03-measurements.md`, section 15). That needs coverage of
child processes.

## D53. A test has the coverage of its child processes (user and agent, 2026-11-13)

The code of the project that runs in a process below a test
process is coverage of the test that runs then. The user decided
that this is on in each run, with no setting: with it off, `ubq
--changed` and `ubq uncovered` give wrong answers for a project
whose tests start a command or a server, and many do.

- **The method:** source counters, through a preload module
  (`src/child-preload.ts`) that each child loads from
  `NODE_OPTIONS` (`--import`) or `BUN_OPTIONS` (`--preload`).
  Not V8 dumps (`NODE_V8_COVERAGE`): they slow all code of the
  process, 2.5 to 14 times, and each process writes 100 to 370 kB
  (`03-measurements.md`, section 15). The counters cost 4 ms for
  each child process, and nothing after that for code that is not
  of the project.
- **The environment:** a test process with source counters
  (`announce` in `src/child-coverage.ts`) sets the two option
  variables and `UBQ_CHILD_COVERAGE`: a JSON list of pairs, the
  root of a project and a folder for the counts
  (`.ubq/children/<pid of the test process>`).
- **A child with a new environment:** on Node, the module changes
  `ChildProcess.prototype.spawn` and the three sync spawn
  functions, so that each environment gets the variables. Without
  this, such a child has no coverage, and nothing says so. tap
  does the same. On Bun and Deno the functions do not have that
  form, so only a child that gets the environment of its parent
  counts.
- **What a child does:** it adds counters to the files of each
  project of the list (a load hook on Node, a plugin on Bun), and
  writes its total counts to the folder: when it exits, when it
  gets SIGTERM, SIGINT, or SIGHUP, and each 200 ms. For a signal,
  it writes and then ends with the same signal. If the program
  has a handler of its own, the module does nothing.
- **What the test process does:** when a test ends, and when the
  file ends, it reads the folder (`src/child-read.ts`), takes the
  difference from the last read, and adds the ranges to the
  `coverage` event, as for a page of a browser (D47). The regions
  of a file come from the cache entry that the child made.
- **A list of projects,** because a test of one project can start
  the tests of a second one. That is each test of ubq that runs
  `ubq` in a fixture project. The nested processes count the
  files of the fixture for their own runner, and the files of ubq
  for the outer test. The two sets have different keys. A file
  that the collector of a test process has gets no second set of
  counters.

**Limits.**

- A child on Deno has no coverage: see "Deno children" below.
- SIGKILL, and each kill on Windows, give no notice. The counts
  since the last write (200 ms at most) are lost.
- Counts that arrive after a test ended go to the next test, or to
  the file.
- A Node that is too old for `module.registerHooks` runs with no
  counters.
- The columns of an error stack that a child prints are those of
  the code with counters.
- A statement after a call of `process.exit` in the same block
  counts as run if the block ran.
- The folders in `.ubq/children/` of a test process that was
  killed stay.

**Deno children: a path forward.** Deno has `--preload <file>` as
an argument, and no variable for it. The spawn functions that this
module changes can add the argument: if the program of the child
is `deno` (or its full path) and the first argument is `run`,
`test`, or `serve`, put `--preload <file>` after that argument.
This fails for a script that starts Deno through a shell or a
wrapper, and it must not run for other subcommands. The collector
in the child is the load hook of Node, which Deno has. A variable
of Deno for a preload module would be the complete answer.

**Coverage of ubq itself.** With D52 and this, `ubq uncovered` in
the repository of ubq sees 50 of the 53 source files. It cannot
see code that runs only on a different runtime (the Bun preload,
the module that workerd runs). The plan for that is coverage from
more than one run, merged: see D54.

## D54. Coverage from more than one environment, in one store (user and agent, 2026-11-13)

An environment is a runtime and a system: `node-linux`,
`bun-darwin`, `deno-win32`. One run in one environment cannot run
each line of a project that has code for more than one. The store
keeps the coverage of each, and the commands that list coverage
read all of it.

- **The table `coverage`** does not change: the last run of each
  test, which `ubq --changed` needs.
- **The table `other_coverage`** has the coverage of a test from a
  different environment, with the content hash of each file.
  - A run in a new environment replaces the rows of a test in
    `coverage`. The old rows go to `other_coverage` first, with
    their environment.
  - A run removes the rows of its own environment from
    `other_coverage` for the tests that it ran: they are older.
  - `ubq merge <store>...` copies the `coverage` rows and the
    `other_coverage` rows of other stores there.
- **`ubq uncovered` and `ubq covers`** read `coverage` and the rows
  of `other_coverage` whose hash is that of the file as it is
  now. A file with no row that counts gets a line that says so,
  and exit code 1.
- **`ubq mutate`** selects tests with the same rows. A test of a
  different environment can be in the selection.

**Reason.** The user wants ubq to check its own tests with no code
marked as not measured. ubq has code for Bun, for Deno, and for
Windows. A project with a branch for each system has the same
need.

**Why a second table, and not a column.** `ubq --changed` reads
`coverage` with one row for each test and file, and moves the
ranges when a file changes. Rows of other environments there
would change that logic. Old rows of other environments are
safe only if they are read with a hash check, which the second
table does.

**In CI of ubq:** each job keeps `.ubq/runs.db` as an artifact.
The job `coverage` merges them and prints the list. It does not
fail for the list yet.

**Limits.**

- Coverage of a file from a different environment is lost when
  the file changes, until the tests run there again.
- A store of a different ubq version is refused.
- The systems must give a file the same bytes. A Windows checkout
  with CRLF line ends has other hashes. This repository has
  `eol=lf` in `.gitattributes`.

## D55. Build output is not source, and a source map gives its coverage to the source (user, 2026-11-13)

Two rules for a project that has built files in its root.

**1. The `build` key.** A list of glob patterns for files that are
not source of the program: the output of a build, and the tools
that make it. With no key: `dist/**` and `scripts/**`, the common
names. `ubq uncovered` leaves these files out and has their count
in its summary. `ubq mutate --diff` does not change them. The
collectors still count them: `ubq --changed` needs that.

**2. A built file with a source map.** If a project file that a
process loads has a `sourceMappingURL` line (a map at its end, or
a file next to it), and the map names source files of the project,
the counters of the built file count for those source files
(`builtSources` in `src/source-map.ts`). The run then has no
coverage of the built file itself.

- **The regions are those of the source file,** from the parser,
  and not those of the built file. A bundler removes code that
  nothing uses. Such code is code that no test ran, and it must be
  in the list.
- **Which counter counts for which region:** a counter of the
  built file counts for the smallest region of the source that
  has the place of its first token. The module of a source ran if
  the built file has code of it.
- **The result is the same** for a test that loads the source, a
  test that loads a bundle, and a test that loads a bundle with
  `minify` (checked in `test/built.test.ts`).
- **A source that changed after the build:** the map has the hash
  of each source text. If a source file does not have that
  content now, the run has no coverage of that file, and the test
  file has coverage `partial`. Wrong places would be worse than no
  places. The user accepted this limit: build again before the
  tests run.
- The cache entry of a built file has the regions of its sources,
  so a child process and the test process that reads its counts
  agree. The text of the map is part of the cache key.

**Reason.** In CI of ubq, the Deno jobs run the built runner, and
`dist/instrument.js` was in the merged list of `ubq uncovered`.
Each project with a build folder in its root has the same
problem. Most coverage tools use the source map, and with it the
choice between tests of `src` and tests of `dist` does not change
the coverage.

**For the tests of ubq:** `scripts/build.ts` makes source maps if
`UBQ_SOURCEMAP` is set, and CI sets it. The published package has
no maps.

**How an agent finds the way to merge runs** (the user asked):
`ubq uncovered` prints a note if a range is on a line that names
a runtime or a system. The note names the section of the guide,
which has the commands for one machine and a workflow for CI. The
skill says not to fake the platform in a test.

**Later changes to D53 (2026-11-13).**

- **Deno children have coverage.** On Node, the spawn functions
  add `--preload=<module>` after the subcommand, if the program is
  `deno` and the subcommand is `run`, `test`, or `serve`. The
  module uses the load hook of Node, which Deno has
  (`src/load-hook.ts`). Not covered: a Deno that starts through a
  shell or a script, and a child of a test process that is Bun or
  Deno. From the source of ubq, Deno cannot load the parser, so a
  file gets counters there only if a Node process made its cache
  entry. The built package has no such limit.
- **A child writes its counts after the `exit` listeners of the
  program,** and before them. A listener can run code of the
  project.
- **The files of ubq that workerd runs have counters** in the
  repository of ubq, for the test process and for the test that
  started it.
- **The package tests build the package in the repository,** with
  source maps (`.ubq/package-test-<pid>`), and run its command
  from the real path. So the runner on Bun, on Deno, and from the
  built files is coverage of `src/`.

## D56. A comment marks code as not measured, with a reason (user and agent, 2026-11-13)

The user agreed to a comment that marks code as not measured, for
the ranges that stay after merged runs (D54) and tests.

- **Form.** `// ubq: not measured: <reason>`, or the same text in
  `/* */`. A comment with no reason does not count: the reader of
  the code must see why no test runs it.
- **Place.** A line with only the comment, above the range. Or the
  first line of the range, or its second line: the range of a
  block starts at `{`, and the comment goes on the first line in
  the block. A comment at the end of a line does not mark the
  range on the next line.
- **Effect.** `ubq uncovered` does not list the range, and does
  not count it for its exit code. It prints how many ranges it
  left out. The store and the other commands do not change.

**Reason.** Some code cannot run in a test: a fallback for a value
that is never absent, or, in the repository of ubq, the preload
modules, which load before the hooks that add counters. With no
mark, the list never gets to 0, and a real gap is hard to see in
it. A count in the output keeps the marks visible.


## D57. Fake intervals with no time, and the output of the runner (user, 2026-11-13)

- **Timer time.** As in Node, a fake `setTimeout` or `setInterval`
  with no time, a time below 1 ms, a time above 2^31 - 1 ms, or a
  time that is not a finite number (`NaN`, `Infinity`, a string),
  waits 1 ms. Node makes a string such as `'5'` a number; the fake
  clock does not. `tick(0)` stays: it runs the `setImmediate`
  callbacks and lets promises settle, with no move of the clock.
- **Raw output of a child process.** In a run of many files, the
  text does not show output of a test process that is not from a
  test. The runner prints results, and failures with the next
  command to run, and nothing else.

## D58. A change that only a file error or a timeout kills runs again (user, 2026-11-13)

Answer to Q13. In `ubq mutate`, a change is killed at once if a
test fails with an assertion or an error. If only a file error (a
crash, an early exit, a stop by the runner) or a timeout came, the
same tests run one more time with the same change. The change is
killed only if a failure of any kind comes again.

**Reason.** A crash or a slow moment of the machine must not hide a
change that no test catches. A real loop or crash comes again. The
cost is one more run only for such a change.

## D59. The npm script `test:update` writes snapshots (user, 2026-11-13)

D76 replaces this decision: ubq does not read the name of the npm
script.

When `npm_lifecycle_event` is `test:update`, the run has
`--update`. The guides suggest `"scripts": { "test": "ubq",
"test:update": "ubq" }`. `ubq convert` changes the tap scripts
`"test": "tap"` and `"snap": "tap"` (or `"snapshot": "tap"`) to
these two.

With this script, a run of all tests writes all snapshots. A
plain `ubq --update` with no test stays an error (D31): a person
who runs the script chose the update of all snapshots, and a
person or an agent who types `--update` names the tests.

**Reason.** tap writes snapshots for the npm scripts `snap` and
`snapshot`. A project that moves from tap keeps the same habit,
with a name that says what the script does.

## D60. Wants of `01` that wait for a real project (user, 2026-11-14)

Answers to Q15, Q16, Q18, and Q20.

- **No free port fixture.** A server listens on port 0 and reads
  its port. That is a usual form in JavaScript, so the guide does
  not show it.
- **No seeded random source now.** It can come later.
- **No capture of network requests, child processes, or files.**
  `spyOn(globalThis, 'fetch')`, `mockImport`, and `testdir` do
  this work.
- **`ubq weak` comes later.** It lists the tests that run no code
  that other tests do not run. It is a hint, not a failure.
- **D29 stays: no check of globals.** A copy of `globalThis`
  before each test, and a comparison after it, costs time in each
  test, and rarely finds a problem. A project can also want such a
  check for a full test file, not for each test. ubq adds it only
  when a real project needs it.

**Reason.** Each of these adds API or cost. ubq adds it when a
real project shows the need.

## D61. A run names the code that no test ran (user, 2026-11-14)

Answer to Q14. If the files that a run has coverage of have ranges
that `ubq uncovered` lists, the run prints a note before the
summary line, with the count and the command:

```
note: 3 ranges of code in the files of this run ran in no test. To list them: ubq uncovered
```

- The count uses the coverage of each stored test, as `ubq
  uncovered` does. Test helpers, build files, and ranges with a
  `ubq: not measured:` comment do not count (D51, D55, D56).
- The exit code does not change. A CI job that must fail for such
  code runs `ubq uncovered` as a second step.
- The `run-end` event has the count as `uncovered`.
- A run of part of the tests, or on one runtime, can get the note
  for code that a different run reaches. An agent that runs and
  merges more than one run knows that.

**Reason.** An agent sees the code that its change did not test
when it reads the result of the run. It does not have to remember
to run `ubq uncovered`.

## D62. Commands win over paths, and `ubq run` takes only paths (user and agent, 2026-11-14)

- `ubq <path>` stays the short form to run tests. A failure block
  prints `rerun: ubq <file>:<line>`, and an agent tries `ubq
  <file>` first, as for other test tools.
- A first word that is the name of a ubq command is the command.
  If a file or folder in the working directory has that name too,
  ubq prints a note to stderr with the form that runs it: `note:
  "diff" is a ubq command. To run the tests in ./diff: ubq run
  diff`.
- `ubq run <paths and options>` treats each argument as a path or
  an option, never as a command. `ubq run` with no path runs all
  tests. tap and vitest have the same `run` command, so an agent
  can guess it. `./diff` also works.
- A new command can hide a folder of a project. Choose names that
  are not common folder names.

**Reason.** A subcommand for each run, such as `ubq test <file>`,
makes the most common command longer, and `test` is the most
common name of a test folder. A note at the time of the conflict
shows the rule when it matters.

## D63. `ubq lsp`, a language server for the store (user and agent, 2026-11-14)

Phase 1 of the editor work. `ubq lsp` is a language server over
stdio, with no dependency: the base protocol is JSON with a
`Content-Length` header.

- **Diagnostics.** The ranges that `ubq uncovered` lists, with
  severity Information. The failure of the last run of each test,
  and the file error of the last run of each test file, with
  severity Error, at the place of the failure.
- **Hover.** The tests that ran the code at the place (`coversAt`),
  20 at most, then `ubq covers <file>:<line>`.
- **Run the tests of a line.** A code action at the line of the
  cursor, "Run the tests that ran this line (ubq)", with the
  command `ubq.run`. Its arguments are the test IDs, and the test
  files whose load ran the line. The server runs `ubq run` with
  them, with its own copy of ubq, and answers when the run ends. It
  sends the start and the summary line as `window/showMessage`
  (Error if the exit code is not 0). An action works in each
  editor. The Neovim plugin has `:UbqRunLine` for it.
- **Changed files.** The stored places are offsets in a file with
  a known hash. If the text in the editor differs from the file
  on disk, or the file changed after the last run of its tests,
  the server shows one Information diagnostic that says so, and no
  coverage, failures, hover, or action. A mapping of old places
  through a diff can come later.
- **Updates.** The server watches `.ubq`. When a run writes the
  store, each open file gets new diagnostics. If `.ubq` does not
  exist, the server watches the project folder until it does.
- **Project.** The folder of `rootUri`, else the working directory.
  The server does not create `.ubq`.

**Why Information for code that no test ran.** A warning in each
untested function is noise in an editor. Claude Code gives the
model the errors and warnings of a server after an edit, and its
docs do not name Information. So the model sees the failures, and
not the uncovered code. The D61 note of the run tells the agent
about that code.

**Neovim.** `ubq nvim` writes `lsp/ubq.lua` and `plugin/ubq.lua`
(from `nvim/` in the package) to the configuration folder that
`nvim` names. The config starts the server only in a project with
`node_modules/.bin/ubq`, in its folder or a folder above it, and
runs that file. It does not use `npx`, which can offer to download
a package in a project that does not use ubq. It needs Neovim
0.12: a `cmd` function gets the root folder there.

Later phases: a code lens with the count of tests and a command to
go to them, and a VS Code extension.


## D64. A VS Code extension for `ubq lsp` (user and agent, 2026-11-15)

The extension (`vscode/`) starts `ubq lsp` with
`vscode-languageclient`. It is a package of its own, with its own
lock file, so the install of ubq does not get the packages of the
extension. esbuild makes one file, `out/extension.js`, and the
`.vsix` has no `node_modules`.

- **Which ubq.** The first workspace folder that has
  `node_modules/.bin/ubq` (`ubq.cmd` on Windows), in its folder or
  a folder above it, as in the Neovim plugin. One server for each
  window. The client registers the command `ubq.run` of the
  server, and VS Code lets only one client register a command.
  The other folders of a workspace with many roots get no server.
- **Run the tests of a line.** The server's code action is in the
  light bulb menu. The command `ubq.runLine` applies it with no
  menu, as `:UbqRunLine` does in Neovim.
- **Tests.** `vscode/test/run.mts` makes a project with a stored
  run, and starts a real VS Code with `@vscode/test-electron`.
  `test/suite.cjs` checks the diagnostics and the hover in VS Code,
  and runs `ubq.runLine`. Then `run.mts` checks that the store has
  a second run. It is not in the suite of ubq: it downloads VS Code
  and opens a window. The CI job `vscode` runs it.
- **Publish.** With `.github/workflows/vscode.yml`, to the
  Visual Studio Marketplace (`vsce publish --oidc`) and Open VSX
  (`ovsx publish --trusted-publishing`). Trusted publishing needs
  no stored token. Open VSX needs a token for the first version
  only. `vscode/PUBLISH.md` has the steps for a person.
- **Version.** The version of the package. The `version` script of
  `package.json` sets it in `vscode/` in the commit of `npm
  version`. The push of the `v*` tag starts `vscode.yml` and
  `release.yml`, and `vscode.yml` checks that the tag names the
  version of the extension. A test fails if the two versions
  differ.

## D65. Go to the tests of a place (user and agent, 2026-11-15)

From a line of code, the editor goes to the tests that ran it, as
it goes to a definition: one place opens, and many places show as
a list.

- **Request.** `ubq/tests`, with the parameters of a hover (a file
  and a position). The answer is a list of LSP `Location`s: the
  line of each test that ran the code at the position (`coversAt`,
  as the hover), in the order of the test IDs, then the first line
  of each test file whose load ran it. The line of a test is the
  `line` of its last row in `test`. A file that is not open, a
  file with no run, a changed file, and no store give `[]`.
- **Why not `textDocument/definition` or `implementation`.** An
  editor sends those to each server of a file, and puts all the
  answers in one list. Then each `gd` in a TypeScript file would
  list the tests with the definition. A request of ubq's own needs
  a command in each editor plugin, so another editor needs a few
  lines of config to use it.
- **Neovim.** `:UbqTests`: `show_document` for one place, else
  the quickfix list and `copen`, as `vim.lsp.buf.definition` does.
- **VS Code.** `ubq.tests`: `editor.action.goToLocations`, with
  `goto` for one place and `peek` for more.

## D66. `ubq status`: the runs in progress (user, 2026-11-15)

Q19. An agent usually waits for a run to end, but a run that takes
too long needs a way to find the test that hangs.

- **Status file.** A stored run writes `.ubq/now/<run>.json`: the
  process ID, the start time, the command, the count of test files,
  the counts of results so far, and each file that runs with its
  start time and the test that runs in it with its start time. It
  writes the file at the start of the run, then at most every
  250 ms after a change (a write to a new file, then a rename). It
  removes the file at the end of the run. The store does not get
  this state: a new table needs a new schema version, which removes
  the stores of users, and a run that was stopped would leave rows
  that say it still runs.
- **Load.** A test file sends `file-start` after its top-level
  code. The runner tells the status file when it starts the
  process of a file, so a file that hangs while it loads shows. A
  run of one file (the plain path) writes its status file only
  after the top-level code.
- **Command.** `ubq status` prints each run in progress, in the
  order of its number. If the process of a run is gone, it says so
  and removes the file. With no file, it prints `no run in
  progress`. The exit code is 0.

## D67. `ubq check`: the last results are the results of the code, and a stop hook (user, 2026-11-15)

D3 says that the tool must not depend on the agent to remember a
step. An agent that ran `ubq`, then changed code, can still report
the first `pass:` line. `ubq check` tells if that line is still
true, and a stop hook makes the agent ask.

- **Checks.** `ubq check` runs no test. It fails (exit code 1) for
  a run in progress, no stored run, a test whose last result is a
  failure or a file whose last run had an error (as `--failed`
  selects), a test file that `--changed` selects, type errors in
  the last run, and code in the lines that differ from a git
  commit that ran in no test or that no test loads (as `uncovered
  --diff`). Each problem names the command to run.
- **Order.** The lines are checked only when the other checks
  pass. With a test to run again, the stored places can be wrong,
  and the first step is to run the tests.
- **A test file with no coverage.** `--changed` always runs it,
  because it cannot know what it ran. `check` asks for it again
  only if the file changed. Else the check could never pass on such
  a runtime.
- **The state of the tree.** No `git status` (D27). The content
  hashes of the store tell if the code that a test ran changed.
  `git diff` runs only for the lines, as in `uncovered --diff`.
- **`--hook`.** The output is the JSON of a Claude Code stop hook:
  `{"decision":"block","reason":...}`, or nothing, with exit code
  0. The hook blocks one time for each report. It keeps the last
  report in `.ubq/check-hook`, and lets the agent stop if the
  report is the same. The agent saw it, and can tell the user what
  it could not do, such as code that only another runtime runs.
  Any change to the code or the results makes a new report, which
  blocks again. Claude Code also stops a loop of blocks by itself,
  after 8 blocks with no tool call.
- **Install.** `ubq skill` adds the hook to `.claude/settings.json`
  when it writes `.claude/skills`, with `npx --no ubq check --hook`.
  It keeps the other settings, does nothing if a hook with `ubq
  check` is there, and does not change a file that is not JSON. It
  prints the entry to add by hand.
- **Not done.** Hooks of other agents (Codex, Cursor, Gemini): their
  forms were not checked. The JSON of Claude Code may work for
  Codex.

**Reason.** The stop hook is the one place where the tool sees the
end of the work of an agent. A block there costs one turn of the
agent, and saves a wrong report to the user.

## D68. `ubq review`: the changes to the tests that a person must look at (user, 2026-11-15)

Section 7 of `01`: an agent that must make tests pass can make a
test weaker, and the tool must make that easy for a reviewer to
see. `ubq check` (D67) tells if the tests pass. `ubq review` tells
if they still test what they tested.

- **Source.** The test files of the diff, at the base commit (`git
  show`) and now, parsed with the parser of the counters. A test is
  a call of the local name of `test` from `'ubqtest'`, in calls of
  `describe`, with a name of plain text. The ID is the ID of a run.
  An assertion is a call of the local name of `assert`, or of one
  of its methods, in the test function. Its text, with its space
  made one space, is what review compares.
- **Static, not from runs.** The store does not know the state of a
  test at the base commit: a run records the commit, not the
  changes in the tree (D27), so two runs of one commit can be of
  different code. The source at the commit is certain. A loop of
  assertions counts as one call.
- **Items.** In this order: a changed `ubq` key; a removed test; a
  new `skip`; fewer assertion calls; changed assertion calls; a
  removed or changed snapshot entry; a new `ubq: not measured:`
  reason. New tests, new assertions, and new snapshots are not
  items.
- **A new name.** A test that is gone is the same test as a new test
  of the file with the same body, or with each of its assertions.
  It is not removed, and review compares the two: `<new ID> (was
  <old name>)`. A moved file keeps its tests (`git diff -M`).
- **`not measured`.** Only comments, from the parser, of program
  code: not a string, not a test file, not a helper or build file,
  and not a file that is not code.
- **Changed code.** For an item about assertions, the store tells if
  the test ran a changed line of code that is not test code: the
  first such line is in the item. An expected value that changed
  with the code is the form of a test that follows a defect. When
  the coverage of a changed file is older than the file, a note
  says to run `ubq --changed`.
- **Base.** `--diff=<commit>` (default `HEAD`), as `uncovered` and
  `check`. The base is the merge base of that commit and `HEAD`, so
  the newer commits of `main` are not changes of a branch.
- **Exit code.** 1 if there is an item, as `uncovered`. An item is
  not an error: a CI job can show the list, and a person decides.
- **CI.** The `coverage` job of ubq runs `ubq review` on a pull
  request, with the merged stores of all jobs, and keeps one comment
  up to date (found by the marker `<!-- ubq review -->`). It writes
  a comment only once the list has an item. A pull request from a
  fork gets the list in the job summary. The guide has a short form
  for other projects. The test files of merged coverage
  (`other_coverage`) are test files for `review`, `uncovered
  --diff`, and `check`: a store from `ubq merge` alone has no
  `test_file` rows.

**Reason.** The weakest test changes are short in a diff: one
`skip`, one changed number. A list that names each one, with the
code that changed next to it, is fast for a person to read.

## D69. A failure names what changed after the last pass of the test (user, 2026-11-15)

Idea 3 of the review of the project. The first question about a
failure is "what broke it?". The store already has the answer: the
coverage of the last run of the test, and the content of each file
that it ran (`.ubq/sources/`, kept for `--changed`).

- **When.** The runner adds `since` to the failure of a `test-end`
  before it gives the event to its sinks. The coverage rows of the
  test are then still those of its last run: the store writes the
  new rows after the `test-end`. Both runners do it: the run of many
  files, and the run of one file in its own process.
- **What.** If the last stored result of the test is a pass: for
  each file of its coverage whose content differs now, a line diff
  of the stored content and the content now, and the groups of
  changed lines that the test ran then. New lines with none removed
  count if the test ran a line next to them. A place is `file:12`,
  `file:12-14` (the lines now), `file:12 (lines removed)`, or
  `file (removed)`. The text block names 5 places at most.
- **No change.** If no code that the test ran changed, the line says
  so: the cause is in data that is not code (a snapshot, a JSON
  file), in the environment, or the test is flaky, with `ubq
  --repeat 10 '<id>'`.
- **A second failure** keeps the `since` of the failure before it:
  the coverage rows are then of a failed run, and the last pass is
  the same.
- **No line** for a test with no pass before its failure, or with no
  coverage rows from that pass.
- **Line diff.** The common lines at the start and at the end, then
  the longest common sequence of the lines between. A change of
  more than 4 million cells of that table is one group.
- **Cost.** Only a failure pays: a query of the store, and the read
  and diff of the changed files that the test ran.
- **Limit.** A change that `--changed` moved the ranges of (a test
  that did not run the change) is not a change of that test, which
  is correct. A file that no test loads as code (JSON, config) is
  not in the coverage, so it is not named.

## D70. A survivor of `ubq mutate` names the closest tests (user, 2026-11-15)

A `SURVIVED` block said how many tests ran the changed code, and
named `ubq covers`. An agent then had to choose a test. Now the
block names up to 3 of the tests that ran the code, with their
lines, the closest first.

- **Order.** First the tests of a test file whose name, up to its
  first dot, is that of the source file (`price.test.ts` for
  `src/price.ts`). Then the tests that ran the least code outside
  their test file and the test helpers, from their stored coverage:
  a small test of the function is the place for a new assertion.
  Then by ID.
- **Code that runs while a file loads** has no one test: the block
  names each such test file on its own line, and says to call the
  code in a test.
- **More tests** than the block names: `ubq covers <file>:<line>`
  lists all.
- One line after the blocks says what to do: add an assertion that
  the change breaks to the first test, or a new test next to it.
  With no test named in any block, the line is not there.

## D71. Annotations in GitHub Actions (user, 2026-11-15)

Idea 5 of the review of the project: show results where the person
already looks. A reviewer of a pull request reads the view of the
changes, not the log of a job.

- **When.** `GITHUB_ACTIONS` is `true`. No option: the form is that
  of GitHub, and other systems do not read it.
- **What.** Each `FAIL`, `ERROR`, and `TYPE` block of a run has one
  `::error` line before it: the place of the failure, the head of the
  block as the title, and the message, the difference, and the
  `rerun:` command as the text. `ubq uncovered` has one `::warning`
  line for each range (`ran in no test`, with the end line), and for
  each changed file that no test loads. `ubq failures` prints none:
  the failures are of a run that printed them.
- **Paths** are from `GITHUB_WORKSPACE` when the project is in it.
  A project in a folder of a monorepo then gets annotations on the
  correct files.
- **Limits.** GitHub shows 10 annotations of each kind for a step,
  and 50 for a job. The text block is the same as before, after the
  annotation, so a person who reads the log reads the same thing.
- **The tests of ubq** remove `GITHUB_ACTIONS`, `GITHUB_WORKSPACE`,
  and `GITHUB_STEP_SUMMARY` from their environment, as they remove
  `CI`, so that the CI of ubq does not change their output.

## D72. `ubq report`: what the tests show, as markdown (user, 2026-11-15)

D74 replaces this decision: `ubq check` prints the evidence.

Idea 5 of the review of the project. A person asks an agent "how do
you know that it works?", and the answer is often a sentence with no
evidence. `ubq report` is the evidence, in a form to paste.

- **Content.** A pass is one line: `**pass**: 17 tests pass on the
  code as it is now, and each changed line ran in a test.` The count
  has the last result of each test, not the counts of the last run:
  a run of some tests does not show how many tests pass. A fail has
  a `### Tests` heading, the result of `ubq check` in bold with its
  text, and its problems in a text block. In a git repository, the
  count of the items of `ubq review`, and the items and notes in a
  text block, if there are some.
- **Only what the reader needs.** No line says that there is nothing
  to report. No run number on a pass: a reader of a pull request
  cannot look up a run in the store of the author.
- **No new data.** It reuses `checkResult` and `reviewItems`, the
  code of the two commands. It runs no test.
- **Exit code 0.** It is a report: `ubq check` is the command that
  fails.
- **Not in it.** The mutation check: it runs tests, and is slow. A
  person who wants it runs `ubq mutate --diff`.
- **Where.** The lines for `AGENTS.md` or `CLAUDE.md` (README, home
  page, the evals) and the skill tell the agent to end its last
  message with the output.

## D73. A run writes the summary of a step of GitHub Actions (user, 2026-11-15)

Idea 5 of the review of the project. The page of a run of GitHub
Actions shows the summary of each step above the logs. A person sees
the result there with no scroll through a log.

- **When.** `GITHUB_STEP_SUMMARY` names a file: GitHub sets it in
  each step. Not for `ubq failures`, which prints a stored run again.
- **What.** A section for each run: `### ubq: <the result line>`, a
  table of the failures, the file errors, and the type errors (the
  kind, the test or the file, the first line of the message, the
  place, and the command that runs it again), 20 rows at most, then
  `And N more` with `ubq failures <run>`. Then the notes of the run:
  type errors in files that it did not use, and code that no test
  ran.
- **All failures**, also those past the limit of 20 blocks of the
  text.
- **The write** appends to the file, and a write that fails does not
  change the result of the run.

## D74. `ubq check` prints the evidence; no `ubq report` (user, 2026-11-16)

D72 made `ubq report`, which printed the result of `ubq check` and
the items of `ubq review`. An agent ran `check`, then `report`. On a
fail, `report` was the output of `check` under a heading. On a pass,
the two said the same thing in different words. Fewer ways to do one
thing is a goal of the project: agents and people make fewer
mistakes, and take fewer shortcuts.

- **One command.** `ubq check` does the work of both. There is no
  `ubq report`.
- **A pass.** The changes to the tests to look at, if there are
  some, then the last line: `pass: 17 tests pass on the code as it
  is now, and each change ran in a test.` The count has the last
  result of each test. The exit code is 0. The agent ends its last
  message with this output.
- **A fail.** The problems, each with its command, then `fail: ...`.
  The exit code is 1. There is nothing to paste: the work is not
  done.
- **Only what the reader needs.** No run number (a reader of a pull
  request cannot look it up), no counts of the last run, and no line
  that says there is nothing to report.
- **`--hook`.** As before. On a pass it prints nothing.

## D75. Red and cyan at a terminal (user, 2026-11-16)

A person who reads the output of a run at a terminal finds the
result faster in color.

- **When.** stdout is a terminal (`isTTY`), `CI` is not set,
  `NO_COLOR` is not set, and `FORCE_COLOR` is not `0`. An agent, a
  pipe, a file, and a CI log get no color.
- **What.** Red (`\x1b[40;31m`): `FAIL`, `ERROR`, and `TYPE` at the
  head of a block, `SURVIVED` of `ubq mutate`, and `fail`. Cyan
  (`\x1b[40;36m`): `pass`. These are the words that the site colors.
  They are in the result lines of a run, of `ubq failures`, and of
  `ubq check`, the status of `ubq show`, `ubq history`, and `ubq
  diff`, and the new file errors of `ubq diff`.
- **Not green.** Many people see red and green as near the same
  color. Red and cyan are different for more people.
- **Not in data for a program.** GitHub annotations, the summary of
  a step, and the JSON of `ubq check --hook` have no color.

## D76. `ubq --update` with no test writes all snapshots; no npm script switch (user, 2026-11-16)

- **No switch.** ubq does not read `npm_lifecycle_event`. Two
  scripts with the same command (`"test": "ubq"` and
  `"test:update": "ubq"`) that do different work surprised an
  agent. A project that wants a script for the update writes
  `ubq --update` in it, with the name that it likes.
- **`ubq --update` with no test** runs all tests and writes all
  snapshots, as the `test:update` script did. With other options
  (`--failed`, `--repeat`) it is still an error.
- **`ubq convert`** changes the tap scripts `"snap": "tap"` and
  `"snapshot": "tap"` to `"ubq --update"`, and keeps their names.

## D77. `assert.contains` and `assert.notContains` (user, 2026-11-16)

`assert(text.includes(x))` fails with "expected a truthy value, got
false". The reader cannot see the text, and adds a `console.log`
to see it. Agents asked for a better form two times.

- **What.** `assert.contains(actual, expected)` passes if the text
  `actual` has the text `expected` in it, or if an element of the
  iterable `actual` is `expected` (the rule of
  `Array.prototype.includes`). `assert.notContains` is the
  opposite.
- **The failure** shows the text or the elements. In text longer
  than 400 characters, it shows the 400 characters near the
  longest start of `expected` that the text has, and says where
  they are.
- **Types.** `null` and `undefined` are accepted, and fail. A
  value from an index or an optional chain needs no `?.` or `!`.
- **`ubq convert`** changes `toContain`, `not.toContain`, and
  `toMatch` with text to these.

## D78. An import with no extension finds the file, and an import of a folder finds its index file (user, 2026-11-17)

An addition to D42. Source for a bundler imports `./a` for the
file `./a.ts`, and `./dir` for the file `./dir/index.ts`. Bun
finds these files. Node and Deno do not. In a conversion of a
large vitest project (`19-sonnet-feedback-0.0.16.md`), no test
file loaded on Node: six agents each wrote a loader of their own
and set it with `NODE_OPTIONS`, and two ran the tests on Bun for
this reason only.

- **The rule.** If a relative import or `require` names no file,
  or names a folder, the resolve hook of the preload tries these
  names, in this order: the source name of a JavaScript name
  (D42), the name with `.ts`, `.tsx`, `.mts`, `.js`, `.mjs`,
  `.jsx`, `.cjs`, or `.json`, then `index` with each of these
  extensions in the folder of that name. This is the search of
  the Workers host (`src/workers-host.ts`).
- **Cost.** The hook does this work only for a name that has no
  file. A project that writes the extensions pays nothing.
- **`mockImport` on Bun.** Bun calls no resolve hook for a
  relative path with no extension. The library reads the path
  from the text of the loader, and finds the file from the folder
  of the file that called `mockImport`.
- A test file that runs as a plain program on Node has no
  preload, as in D42.

**Reason.** D42: a project that moves to ubq must not have to
change each import of its source first. An agent that has to make
a loader makes a different one each time, and some of them are
wrong.

## D79. `ubq doctor` names the files with syntax that Node cannot run (agent, 2026-11-17)

From the same report. `ubq doctor` asked for `erasableSyntaxOnly`
on each runtime. The project had two source files with parameter
properties, so it ran its tests on Bun. The option then made the
type checker report those two files in each run, and each run
ended with `fail`.

- `ubq doctor` on Node reads each TypeScript file of the project
  that is not a declaration file or a build file (D55) with the
  function of Node that removes types. A file that the function
  refuses is in a `FIX` line, which gives the choice: change the
  syntax, or run the tests on Bun.
- `ubq doctor` does not ask for `erasableSyntaxOnly` if it found
  such a file, or if it runs on Bun.
- The type error TS1294 has a `hint:` line with the same choice.
- The command for Bun in each message and guide is `bun
  node_modules/ubqtest/cli.js`. With pnpm, `node_modules/.bin/ubq`
  is a shell script, and Bun cannot run it.

D80 decides the way to run such syntax on Node.

## D80. For syntax that Node cannot run, the agent asks the person (user, 2026-11-17)

Q22. Node 24 has `--experimental-transform-types`. Node 26
removed it ("bad option"), so ubq cannot use it. A switch to Bun
is a surprise to a maintainer, and so is a build step: a test run
with no build is a large part of the value of ubq on Node.

- `ubq doctor`, the load error of a test file, and the TS1294 hint
  say: do not choose for the person who owns the project. Ask
  them: change this syntax, run the tests on Bun, or test a build
  of the source.
- `CONVERT.md` and `GUIDE.md` say the same.

## D81. `clock.set(time)` sets the time of `Date` (user, 2026-11-17)

Q25. `vi.setSystemTime(t)` changes `Date.now()` in a test, also
back in time.

- `clock.set(time)` takes a number or a `Date`. It changes `Date`
  and `clock.now`, and runs no timer.
- `performance.now()`, `process.hrtime()`, and the timers do not
  change. They are monotonic, as the real ones are: a time back in
  time does not make a timer wait longer, and a time forward does
  not run a timer. Only `tick` and `runAll` run timers.
- The converter hint for `setSystemTime` names `clock.set`.

## D82. `stub(object, key, value)` (user, 2026-11-17)

Q24. `vi.stubGlobal(name, value)` sets a global until the test
ends. Agents wrote their own helper with `Object.defineProperty`
and `cleanup`. A put-back is easy to get wrong: a property that
did not exist, a getter, or a property of the prototype.

- `stub(object, key, value)` sets an own property that is
  writable and configurable. When the test ends, the old own
  property comes back as it was, or the property is deleted if the
  object had no own property. Outside a test, the change lasts
  until the file ends, as with the other fixtures.
- A property that is not configurable throws.
- The value has the type of the property if the object type has
  the key, and `unknown` if not. A fake with too few properties is
  then a type error, and the test casts it.
- `env()` stays for `process.env`.
- `ubq convert` changes `vi.stubGlobal(name, value)` to
  `stub(globalThis, name, value)`, and `vi.stubEnv(name, value)`
  to `env({ name: value })`.

## D83. The `define` key: global values for the source (user, 2026-11-17)

Q21. The vite config of a project had `define: { __DEBUG_BUILD__:
true }`. With ubq, the source threw `ReferenceError` when it
loaded. Each of 8 agents set the value in its own way: a loader in
`NODE_OPTIONS`, a Bun preload, or `BUN_OPTIONS="--define ..."`.

- `"ubq": { "define": { "NAME": value } }`. Each key is a global
  name (no dot). Each value is a JSON value.
- The preload of each test process (Node, Bun, Deno) sets the
  values on `globalThis` before the test file loads. The library
  sets them again when it loads, for a test file that runs as a
  plain program. That file must import `ubqtest` before the source.
- ubq does not change the source as vite does. A transform of the
  source costs a parse of each file, and is a second way to build.
  The difference: `typeof NAME` and dead code.
- No `preload` key. It would put the setup of a test outside the
  test file (`05-api.md`, section 2).
- `ubq convert` reads `define` of `vitest.config.*` and
  `vite.config.*` at the project root, and writes the key. A
  string value is code for vite: the command reads it as JSON
  (`'true'`, `'"text"'`). `JSON.stringify(value)` and a number or
  a boolean also work. A name with a dot, or a value that is not
  plain, gets a note. A config that spreads a config from a
  different file, and has no `define`, gets a note.
- Browser tests and Workers do not use the key: vite and wrangler
  have their own `define`.

## D84. `ubq convert` makes loops of `each`, and keeps the TODO for hooks (user, 2026-11-17)

Q26. The agents wrote about 200 loops for `it.each` by hand, and
about 500 `setup()` calls.

- `it.each(table)(name, fn)` and `describe.each` become `for
  (const row of table) test(name, fn)` when the change is certain:
  - The table is an array literal of arrays, of objects, or of
    single values (not mixed).
  - The function has parameters that are names, or one object
    pattern with shorthand keys for the object table.
  - Each value that the name uses is a literal, so that the
    command knows each name. `%s`, `%d`, `%i`, `%f`, `%j`, `%%`,
    `%#`, `$#`, and `$key` work. `%o`, `%O`, `%c`, and `$a.b` keep
    the TODO.
  - If two rows give one name, the command adds the index.
  - The table reads no name of the loop, and the index `i` hides
    no name of the test.
  - The types of the parameters become a cast of the table. A
    function with types on only some parameters keeps the TODO.
- The names of the converted tests do not match the names of
  vitest. They are different for each row, and they show the
  values.
- A tagged template table (``it.each`a | b` ``) gets the TODO.
- Hooks keep the TODO. The change is certain only for few forms,
  and a group of tests that share state is a design that the agent
  must look at.

## D85. A function in a pattern is a predicate (user, 2026-11-17)

Q23. vitest has `expect.any(Number)` and `expect.anything()` at
any depth of an expected value. The sentry corpus has 270 and 46
of them, and each of the eight agents wrote a helper for them.

- In a pattern of `assert.match`, `assert.eventually`, and the
  object form of `assert.throws` and `assert.rejects`, a function
  gets the value at its place. The value matches if the function
  returns `true`.
- The type of such a function must be `(value: unknown) =>
  boolean`. Any other function in a pattern is a compile error
  that names `assert.equal`. A test that wants to compare two
  functions as values must not get a call of one with the other.
  The check does not use the type of the value, so it works for
  `unknown` too. It reads the pattern that the call has as an
  object literal. It does not go into a pattern from a variable
  with a wider type, or into a class instance.
- At run time, a result that is not `true` or `false` is a
  failure that says the same.
- If the function and the value are the same function, they
  match, and the function does not run.
- A key that the value does not have gives `undefined` to the
  function.
- A failure shows the path, the value, and the text of the
  function, with no coverage counters. If the function throws,
  the failure shows the message of the error.
- At the top level of `expected` in `throws` and `rejects`, a
  function is a class, as before.
- `assert.deepEqual` does not change.
- `ubq convert` changes `expect.any(X)` and `expect.anything()` in
  a pattern. In an exact comparison they keep the TODO: a change
  to `assert.match` permits more keys, and the agent must decide
  it.
- No `any(Number)` export and no `assert.typeof`. `assert.equal(
  typeof x, 'string')` reads as well as `assert.typeof(x,
  'string')`. An export for each common case is a second way to
  do one thing. It can come later, on top of the function, if
  agents find the function hard to use.

## D86. No command that runs each runtime (user, 2026-11-17)

Q17. A person runs `ubq` on each runtime, CI makes the matrix,
and `ubq merge` joins the coverage. A `--runtimes` option waits
until a user asks for it.

## D87. A spy does not change after it is made (user, 2026-11-17)

Q27. vitest has `mockClear`, `mockReset`, `mockReturnValue` on a
spy that exists, and `mockImplementationOnce`. Six of eight
agents asked for them.

- No new API. A spy that changes in a test is the design that
  ubq left out.
- The hints, `CONVERT.md`, and `GUIDE.md` have the forms: an
  implementation that reads a variable, `results.shift()` for a
  different result in each call, and `s.calls.length = 0`.
- A spy from a shared helper or at the top level of a file lives
  until the file ends. The guide says to make it in a function
  that each test calls.

## D88. `mockImport` has no partial form (user, 2026-11-17)

Q28. `mockImport` needs each export that the code under test
imports. Seven of eight agents asked for a form that keeps the
other exports.

- No change. The mock spreads the real module: `{ ...(await
  import('./dep.ts')), fn: spy(impl) }`. The line shows which
  code is real.
- The need was the text of the hint, and the hint of `vi.mock`
  has this form.

## D89. The expected error is not an Error instance (user, 2026-11-17)

Q29. `toThrow(error)` with an Error instance is common, and four
of eight agents hit the type error.

- `expected` of `throws` and `rejects` stays a RegExp, a class,
  or an object pattern. An instance would be a fourth meaning for
  one parameter.
- `ubq convert` writes the pattern: `toThrow(new Error('x'))`
  becomes `{ message: 'x' }`, and `toThrow(error)` becomes `{
  message: error.message }` if the file makes `error` with `new`.
  Any other name with a small first letter keeps the TODO. jest
  and vitest compare only the message of an instance.
- `assert.rejects` takes a `PromiseLike`. It is a wider type, and
  no new rule.
- A rejection with a value that is not an Error has no form of
  its own. A RegExp tests `String(value)`, and the assertion
  returns the value: `const value: unknown = await
  assert.rejects(p, /full/)`, then `assert.equal(value, FULL)`. This is an assumption of the agent: the user
  agreed to the other parts, and did not answer this part.

## D90. `ubq convert` makes a setup function from the certain hooks (user, 2026-11-17)

Q30. D84 kept the TODO for each hook. The agents then wrote about
500 `setup()` calls by hand. This decision changes that part of
D84.

- A scope is the file, or the function of a `describe`. For a
  scope, the command makes `const setup = () => {...}` from the
  `beforeEach`, and `const teardown = () => {...}` from the
  `afterEach`, with `cleanup(teardown)` at the start of the
  setup. It puts `setup()` at the start of each test of the scope.
  A setup in a `describe` calls the setup of the scope around it
  first. An `async` hook makes `await setup()`, and each test
  `async`.
- Only where the change is certain:
  - The scope has one hook of each kind at most, and they are
    before its tests.
  - The hook is a function with a block and no parameters. It
    assigns no variable from outside, and has no `return` and no
    `this`.
  - Each statement of the scope that is a call is a test, a
    `describe`, a hook, or a call of `vi`. A different call can
    make tests that the command does not see.
- Each other hook keeps the TODO. A hook that assigns an outer
  variable is a group of tests that share state, and the agent
  must look at that design.
- Not for tap: a hook of tap runs for each subtest too.
- In the sentry corpus, 81 hook TODOs stay. The baseline before
  D84 had 211.

## D91. A failed `assert` shows its `isDeepEqual` calls (user, 2026-11-17)

Q31. `toHaveBeenCalledWith` passes if any call matches. The
converter writes `assert(spy.calls.some(call =>
isDeepEqual(call.args, [...])))`. A failure of that line showed
only `false`.

- No `assert.calledWith`. It would be a second way to state what
  `assert` with `isDeepEqual` states.
- `isDeepEqual` records its two values and its result in the
  state of the test. Each assertion clears the record. If
  `assert(value)` fails, the report shows each record, 8 at most,
  as `isDeepEqual call 1 gave false` with `actual` and
  `expected`.
- This works for each use of `isDeepEqual` in an `assert`, such
  as `toContainEqual`, and for the opposite form with `!`.

## D92. No transform of the source (user, 2026-11-17)

Q32. Sentry has a vite plugin that removes blocks of the source.
One of eight agents needed it, and wrote a loader.

- ubq has no transform key and no plugins. It tests the code that
  is in the repository. A project that needs a transform tests
  its build.
- `ubq convert` prints a note for a vite config with plugins, and
  `CONVERT.md` tells the agent to tell the user.
- A transform would need a source map for coverage and for stack
  places, in each runtime.

## D93. A DOM is a function in the test file, with `stub` (user, 2026-11-17)

Q33. Files with `@vitest-environment jsdom` failed with `document
is not defined`. Two of eight agents made a jsdom window by hand.

- No test environment and no `ubqtest/dom`. The convert guide has
  the form: a `dom()` function that makes a `JSDOM` window, puts
  the globals that the code reads on `globalThis` with `stub`,
  and closes the window with `cleanup`. A test calls it.
- The TODO for the environment comment names that section.
- The form ran with jsdom on Node: the globals are there in the
  test, and they are gone in the next test.
- A test of real browser behavior belongs in the browser tests.
  The guide says so.

## D94. The tests are in a `tsconfig.json`, with no new key (user, 2026-11-17)

Q34. Sentry has the options of its tests in `tsconfig.test.json`,
and `tsconfig.json` includes only `src`. `ubq doctor` asked for
options in the config of the source.

- No `"tsconfig"` key, and no second file name. The type check
  reads the `tsconfig.json` of each folder from a test file up to
  the root.
- `ubq doctor` finds, for each TypeScript test file, the nearest
  `tsconfig.json` that includes it. It checks the options of
  those files, and names each one.
- If no `tsconfig.json` includes a test file, the FIX line gives
  the file to add in the test folder. It extends
  `tsconfig.test.json` if that file has the tests, and
  `tsconfig.json` with the options and `"include": ["."]` if
  not.
- The check reads `include`, `files`, and `exclude` of the file
  itself. For a config with `references`, or one that gets its
  list from a base config, it does not know, and it reports no
  problem.

## D95. `ubq convert` runs the formatter of the project (user, 2026-11-17)

Q35. `ubq convert` printed the command of the formatter in a
note. Six of eight agents ran it by hand, and one did not see the
note.

- After the command writes the files, it runs the formatter on
  the files that it changed: prettier, oxfmt, biome, or dprint,
  from `dependencies` or `devDependencies` of the `package.json`
  of the project, or of the nearest folder around it that has
  one (a workspace).
- It runs the program in `node_modules/.bin` of that folder, not
  `npx`: no download.
- No option to stop it: one way. `--dry` writes no file, and
  formats nothing.
- If the program is not there or fails, a note gives the command
  to run by hand, with the first line of the error.
- A project with no formatter gets no note.

## D96. A type check with no result fails the run, and the count of other type errors is in the summary (assistant, 2026-11-18)

Two items of `19-sonnet-feedback-0.0.16.md`. The user asked for
the work. The form of each change is an assumption of the
assistant.

- **A checker that stops.** ubq did not read the exit status of
  the type checker. A checker that the system stopped, or that
  failed with no error list, looked like a project with no type
  errors. Now, if the checker ends with a signal, or with an exit
  code and no errors, the run has one more type error with the
  code `ubq`: the checker stopped, and its result is not
  complete. The text has the end of what the checker wrote to
  stderr.
  Windows has no signals: a checker that is stopped there ends
  with exit code 1. ubq sees that only if the checker wrote no
  error before it stopped.
- **The count of the others.** In a run of a selection, the line
  `note: N type errors are in files that this run did not use
  ...` is gone. The summary line has the count: `pass: 0 failed,
  5 passed, 2 type errors in other files`. `otherTypes` of the
  `run-end` event does not change.

**Reason.** Five of eight agents saw different type errors from
runs of the same code. Tests with 40 checkers at the same time on
one data file, and with a cut, empty, or wrong data file, gave
the same errors each time: the shared data in `.ubq/types/` is
not a cause. Each agent changed files in the same tree, and
`tsconfig.test.json`, which changes the errors of each file. That
is the probable cause, and ubq cannot change it. The exit status
was the one place where ubq could lose errors with no sign. For
the count: an agent reads the last line, so the count must stay
(D49), but a line of 150 characters in each run is noise.

## D97. `ubq convert` knows tape and ava (user, 2026-11-18)

The user asked for it: the two tools are like tap, with a test
object as the parameter of each test function.

- **tape** uses the rules of tap, with the other names that tape
  has for each assertion. `t.doesNotMatch` is for a string only.
- **ava** has its own table: `t.true(a)` is `a === true` in ava,
  and `a` is truthy in tap. `test.serial` is `test`. `t.throws`
  with `{ instanceOf: X }` gets the class, and with other keys
  gets the object as a pattern.
- A hook (`test.beforeEach`), `t.context`, a macro, `t.timeout`,
  and `test.failing` get a TODO.
- `t.notThrows(() => f())` and `t.doesNotThrow` become `f()`.
  This and the not-equal names (`t.notSame`) also apply to tap.
- **The end of a test.** For a `t.end()` in a function that is
  not the test function, the test function becomes `() => new
  Promise(end => { ... })`, and each `t.end()` of the test becomes
  `end()` (the user chose this form). The call stays, with a
  TODO, if the test function is async or uses `this`, or if the
  call has an argument. A `t.plan(n)` of tap or tape stays, with a TODO, if
  the test function is not async and a function in it uses the
  test object. A function that is an argument of `forEach`,
  `map`, or `t.throws` does not count. Before this, the command
  removed each such call, also for tap, and the test ended before
  its callback.

**Assumptions of the assistant.** The rule for `t.plan` cannot
see if a callback runs later, so it writes a TODO for some tests
that need no change. In 400 tape files of packages on this
machine, it wrote 305 such TODO comments. A test that ends too
soon passes with fewer assertions, or fails after its end, so a
TODO is the safe side. The command does not change the `test`
script of `package.json` for tape or ava.

## D98. `assert.equal` does not narrow the type (user, 2026-11-19)

`assert.equal(actual, expected)` narrowed the type of `actual` to
the type of `expected`. The user removed this
(`20-seldo-feedback-0.0.18.md`, item 6).

- The signature is `equal<T>(actual: T, expected: NoInfer<T>):
  void`, as `deepEqual` has.
- `assert(value)` still narrows. To narrow a union:
  `assert(shape.kind === 'circle')`.
- To compare two different types on purpose:
  `assert.equal<unknown>(a, b)`, the same form as `deepEqual`.

**Reason.** TypeScript keeps a narrowed type of a property across
a function call. A test reads a field, runs the code under test,
and reads the field again: the second `assert.equal` was a type
error in a correct test. The harm is more than the use.

## D99. `assert.greaterThan`, `assert.lessThan`, and `assert.close` (user, 2026-11-19)

The user added three assertions (`20-seldo-feedback-0.0.18.md`,
items 1 and 5). They add to a small API, against the "one way"
goal, for this reason: `assert(a > b)` shows only `false` in a failure,
and arithmetic by hand for a near value is easy to get wrong.

- `assert.greaterThan(value, target)` and
  `assert.lessThan(value, target)` take a `number` or a `bigint`.
  A failure shows `actual: 0.93` and `expected: > 5`.
- `assert.close(value, target, precision?)` passes if the
  difference is less than `10 ** -precision / 2`, with 2 as the
  default. Equal values pass. This rule and the meaning of
  `precision` are an assumption of the assistant: they are the
  rule of `toBeCloseTo`, so `ubq convert` keeps the number.
- `ubq convert` writes them for `toBeGreaterThan`,
  `toBeLessThan`, and `toBeCloseTo`. Before, `toBeCloseTo(b, 6)`
  lost its precision, and the new check was weaker.
- `>=` and `<=` have no assertion: `assert(a >= b)`.

