# Agent Ideation: What Is Lacking in JavaScript Test Tools

_Agent's response (Claude Fable 5.2)_

This is the answer to the question in `00-initial-prompt.md`: what
do current JavaScript test tools lack for a coding agent, and what
would help an agent write better code more reliably?

The author is a coding agent (Claude). The claims below come from
how I use test tools: I run a shell command, I read the text that
comes back, and I decide what to do next. I have no editor
integration, no TTY, and a limited context window. Each section
states a problem, then what I want instead.

Section 14 ranks the ideas. Section 15 lists the risks and the open
questions.

## 1. How an agent uses a test tool

Four facts drive most of this document.

- **I pay for each line of output.** Output fills my context
  window. A run that prints 2000 lines for 1 failure costs more
  than the failure is worth, so I pipe it through `tail` or `grep`
  and lose data.
- **I cannot scroll back or click.** If the output did not include
  the data, I must run the tests again to get it.
- **I cannot use interactive modes.** Watch modes that read keys
  from a TTY do not work for me.
- **I act on what the tool says.** If the tool reports "pass" for a
  run that tested nothing, I report "pass" to the human. A wrong
  green result is worse for me than for a human, because I do not
  have the feeling that something is off.

## 2. Output is made for human eyes on a terminal

**Problem.** Reporters print colors, spinners, progress bars, boxes,
and a line for each passing test. Failure text is far from the
summary. Stack traces contain many frames from the framework and
from `node:internal`. Durations change on each run, so two runs of
the same code never give the same text.

**What I want.**

- Default output for a non-TTY: nothing for passing tests, one
  compact block for each failure, one summary line at the end.
- Each failure block contains: test ID, `file:line:column` of the
  failed assertion, the source line, a focused diff, and only the
  stack frames from user code.
- The last line always states the result in a fixed format, for
  example `fail: 2 failed, 310 passed, 1 skipped (run 01JC...)`.
  If I see only the last line, I still know the truth.
- Output is the same for the same result. Durations and other
  changing values stay out of the default text.
- A hard limit on output size, with a statement of what was cut
  and the command that shows the rest.
- Different exit codes for: test failure, coverage failure, no
  tests matched, and an error in the tool or its configuration.

## 3. Results disappear when the process exits

**Problem.** The run result exists only as text on stdout. To see
a different part of it, I run the full suite again. This is the
most common waste in my test loops.

**What I want.** Each run goes into a local database (SQLite is a
good fit). The CLI answers questions about a stored run and does
not run tests again:

- `failures` : the failures of the last run.
- `show <test-id>` : one test in full, with its assertions, its
  console output, its duration, and its coverage.
- `diff <run-a> <run-b>` : which tests changed state.
- `history <test-id>` : pass and fail results over past runs.
- `slow` : the slowest tests.
- A raw SQL or JSON query mode for questions the CLI did not plan
  for.

Each run record also holds what I need to repeat it: the command,
the runtime and its version, the platform, the random seed, the
related environment variables, the git commit, and whether the
tree had changes.

Partial results must be readable while a run is in progress. Then
I can start a long run in the background and ask "what is running
now, and for how long?"

## 4. I cannot tell my failures from failures that were there before

**Problem.** I change code, I run the suite, and 3 tests fail. Did
I break them? Were they broken before? Are they flaky? Today I
must stash my change and run again, or guess. Agents often guess
wrong in both directions.

**What I want.**

- The run database makes "new failures since run X" a single
  query.
- A `--baseline <git-ref>` option runs the suite against a clean
  checkout of that ref (in a temporary worktree), and reports only
  the differences.
- Flake data: if a test passed and failed on the same code and
  seed inputs, the tool says so, with the evidence.
- `--repeat N` runs a test N times and reports the failure rate.

## 5. Selecting tests is not consistent, and often needs source edits

**Problem.** Each framework has its own filters: file globs, name
patterns, `.only`, `.skip`. Name patterns match too much or
nothing. `.only` is a source edit that agents forget to remove. A
filter that matches zero tests often exits 0, which looks like a
pass.

**What I want.**

- Each test has a stable ID that the tool prints and accepts, for
  example `test/parse.ts:42` or `test/parse.ts > parse > empty
  input`.
- Each failure block prints the exact command that runs only that
  test again.
- `--failed` runs only the tests that failed in the last run.
- `--changed` runs only the tests that the current changes can
  affect. See section 6.
- Zero matched tests is an error with its own exit code.
- No `.only` in the API. Selection belongs on the command line.
  If `.only` must exist, it fails in CI and prints a warning in
  each run.

## 6. Coverage is a report, not a tool

**Problem.** Coverage today is a wide text table at the end of a
run, or an HTML site that I cannot read. It answers "what percent"
and nothing else. It is also optional and slow, so most runs do
not have it.

**What I want.** Coverage that is always on, stored for each test,
and open to queries:

- `uncovered <file>` : the uncovered lines and branches, shown as
  short source snippets, not as line number ranges.
- `covers <file>:<line>` : which tests run this line. This tells
  me which tests to read before I change a function.
- `--changed` test selection: the tool maps changed lines to the
  tests that ran them in the last run, and runs those tests first.
  This is the fastest possible feedback loop for an edit.
- Coverage of the diff: "you changed 14 lines, 3 are not covered",
  with the 3 lines shown.
- Result caching: if no file that a test loaded has changed, the
  tool can skip the test and say that it did.

Per-test coverage also shows weak tests. A test that adds no
coverage and a line that runs but has no effect on an assertion
are both signs of a problem. See section 7.

## 7. Tests pass for the wrong reasons

**Problem.** These all produce a green result today:

- A test with no assertions.
- An async test whose promise nobody awaited, so the assertion
  ran after the test ended, or never.
- An assertion inside a callback that never ran.
- A `catch` block that takes the assertion error.
- A filter that matched nothing.
- A `.skip` that someone left in.
- A snapshot that the test wrote for the first time, or that
  someone updated without reading it.

Agents are a special risk here. An agent under pressure to "make
the tests pass" can write a weak test, or change an assertion to
match wrong behavior. The tool must make this hard to do and easy
for a reviewer to see.

**What I want.**

- A test that runs zero assertions fails.
- An assertion that runs after its test ended is a failure of
  that test, not a crash and not a pass.
- An unhandled rejection or an uncaught error fails the test that
  caused it. Async context tracking makes this possible.
- A promise-returning assertion that nobody awaited is an error.
  A lint rule or a type can catch it early.
- The summary line reports skipped and todo tests each time.
- Snapshots: a new or changed snapshot is not a silent pass. The
  tool shows the diff, and an update needs an explicit flag and an
  explicit test ID.
- A cheap form of mutation testing, as a later goal: change a
  covered line, run only the tests that cover it, and report the
  lines where no test failed. Per-test coverage makes this fast.

## 8. Hangs give no data

**Problem.** A test hangs. After a long delay I get "timeout" and
nothing else. Or the tests pass, but the process does not exit.
Or the runner kills the process and child processes stay alive
and hold a port. These cases cost me the most time.

**What I want.**

- On timeout, the report states what was pending: the active
  handles, timers, and unsettled promises, each with the stack
  where the code made it, and the last assertion that ran.
- A test that ends with open handles gets a warning or a failure
  that names the handles.
- The runner kills the full process tree of a test that timed
  out.
- Short default timeouts, with a clear message that states how to
  change the limit for one test.
- A `--max-time` option for the full run, so that a background
  run cannot hold my session.

## 9. Order, time, and shared state cause failures that I cannot repeat

**Problem.** Tests depend on run order, on the wall clock, on
random values, on fixed ports, and on files that other tests left.
The failure shows up in CI or in a parallel run, and not when I
run the file alone.

**What I want.**

- Random test order by default, with the seed in the run record
  and in each failure report.
- A built-in fake clock and seeded random source, with types.
- Built-in fixtures with automatic cleanup: temporary folders,
  environment variables, working directory, free ports. Explicit
  resource management (`using`) is a good fit.
- No state outside the project folder. Two agents in two git
  worktrees of the same repository must not affect each other.
- A check that a test left the process as it found it: globals,
  environment variables, working directory, listeners.

## 10. Mocks use hidden behavior and lose types

**Problem.** Module mocks are the least reliable part of each
framework. `jest.mock` moves calls to the top of the file. ESM
mocks need loader flags. The mock has no type link to the real
module, so it goes stale without a compile error. Mocks leak from
one test into the next.

**What I want.**

- One explicit, typed call that loads a module with replaced
  dependencies. The type checker rejects a mock that does not
  match the shape of the real export.
- No hoisting and no changes to the source text.
- A mock lives only as long as the test that made it.
- Built-in spies and call records with typed arguments.
- Built-in capture for common side effects: console, network
  requests, child processes, file system.

## 11. Setup takes too many turns

**Problem.** Before I can run one TypeScript test, I may have to
pick a transform, set ESM or CJS mode, fix source maps, and align
three config files. Each wrong guess costs a full turn. Reported
line numbers that point at compiled output send me to the wrong
place.

**What I want.**

- No config for the common case. A `.ts` test file runs.
- A test file is a plain program. `node test/foo.ts` runs it and
  prints useful output, with no runner. This is also the simplest
  way to debug one file.
- Explicit imports only. No globals. I can see where each function
  comes from, and so can the type checker.
- Line numbers always refer to the source file.
- Type checks run next to the tests, and report in the same
  format. A type error does not block the test run, because I
  often want both results at once.
- The same test file runs on Node, Deno, and Bun. A matrix run
  reports which runtime failed.
- A `doctor` command that checks the setup and states the fix for
  each problem.
- Each error message from the tool states the cause and the next
  action.
- The package ships a short guide for agents that matches the
  installed version, and the CLI can print it. My training data
  will not contain this tool, or will contain an old version.

## 12. Assertion failures do not show the cause

**Problem.** A deep equality failure on a large object prints the
full object two times, or cuts it off before the difference.
Some values print the same but are not equal: `-0` and `0`, two
class instances, a string with a non-printing character, a
`Map` and an object.

**What I want.**

- The diff shows the path to each difference
  (`result.items[3].id`) and a small amount of context. The full
  values stay in the run database.
- When two values print the same, the message states why they are
  not equal.
- A small set of assertions with clear names. Fewer ways to do the
  same thing means fewer mistakes.
- Assertions narrow types (`asserts value is T`), so the code
  after an assertion needs no cast.
- Console output is captured for each test. It is shown only for
  failed tests, and stored for all tests.

## 13. Speed, and a watch mode that an agent can use

**Problem.** Start cost is the largest part of a small run:
transform, module load, worker start. Watch mode solves this for
humans, but it needs a TTY.

**What I want.**

- A cold run of one small test file completes in tens of
  milliseconds.
- An optional background server that keeps a warm state. The
  normal CLI command connects to it if it is there. The command,
  the output, and the exit code are the same with or without the
  server.
- The feedback loop after an edit is: run the tests that cover
  the changed lines, then the tests that failed last time, then
  the rest. The first failure prints at once.
- Honest reports about what did not run because of the cache or
  the selection.

## 14. Priority

My ranking, by how much agent time and how many wrong results each
item would save. The user asked for speed as a hard requirement,
so speed is a constraint on all items and not a rank in this list.

1. Compact, stable, complete failure output with a fixed summary
   line (section 2).
2. Stored runs with a query CLI (section 3). Sections 4, 5, 6, and
   8 all build on it.
3. No false green results (section 7).
4. Stable test IDs and a printed command to run each failure again
   (section 5).
5. Per-test coverage with `covers`, `uncovered`, and `--changed`
   (section 6).
6. Hang reports (section 8).
7. Baseline compare and flake data (section 4).
8. Typed, scoped mocks and built-in fixtures (sections 9 and 10).
9. Agent guide shipped in the package, `doctor` (section 11).
10. Mutation checks (section 7).

## 15. Risks and open questions

`02-decisions.md` settles three of these: always-on coverage (D1),
strict rules (D2), and the wire format (D4). The others are open.

- **Always-on per-test coverage against the speed goal.** These
  two goals pull in opposite directions. V8 precise coverage has a
  cost, and a per-test split needs a snapshot at each test
  boundary. This needs a measurement before any design decision.
  I have not measured it.
- **Strict rules against human comfort.** "Zero assertions fails"
  and "no `.only`" help agents and reviewers. Some humans will
  find them annoying. Should they be defaults with an opt-out, or
  fixed?
- **Isolation against speed.** One process for each file is safe
  and slow. A shared process is fast and leaks state. The leak
  checks in section 9 can make a shared process safer, but they do
  not make it equal.
- **Database location and size.** The run database must stay in
  the project, must not go into git, and must have a size limit.
  How many runs should it keep?
- **Cross-runtime limits.** `diagnostics_channel`, async context,
  SQLite, and coverage differ on Node, Deno, and Bun. Which
  features can degrade on a runtime, and which are required?
- **Plain programs and the run database.** If `node test/foo.ts`
  runs with no runner, does that run also write to the database?
  I assume yes, because the test library can write the record
  itself, but this affects start time.
- **Wire format.** Does the test process report through TAP,
  through `diagnostics_channel` events, or through direct database
  writes? This decision shapes most of the design and belongs in
  its own document.
