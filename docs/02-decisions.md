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

