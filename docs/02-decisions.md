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
   skill` to copy it into `.claude/skills/` of a project) tells an
   agent to read the two guides of the installed package, and
   gives the order of the work.

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
  There is no bundle step.
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
only its default export. No `SELF` fetcher, and no storage for
each test. `fakeClock` does not replace the names of
`node:timers`. Not tried on Windows.

**Reason.** Workers are a common place to run code, and the tests
of a Worker are worth most in the real runtime: they find the
differences from Node. A run on Node with stubs does not. The
trial (`03-measurements.md`, section 14) showed that workerd can
load the files and run the test API with little new code.

**Not chosen:** a `preload` key for a Node hook that maps
`cloudflare:workers` to a stub (the tests would run on Node);
the name `cloudflare:test` answered by ubq (it would promise the
whole API of the vitest plugin); code that runs through an eval
binding, as the vitest plugin does (more code, and positions that
need maps).

