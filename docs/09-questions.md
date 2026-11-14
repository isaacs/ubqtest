# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

The answers to Q1 to Q6 are D25 (step 3) and D26 to D31. The
answer to Q7 is D38. The answer to Q8 is D39. The answer to Q9 is
D45. The answer to Q10 is D48. The answers to Q11 are D49 and D50.
The answer to Q12 is D57. The answer to Q13 is D58.

Q14 to Q20 come from the wants in `01-agent-ideation.md` that the
code does not have yet. The section of that file is in brackets.

## Q14. A run does not tell about code that no test ran (2, 6)

`01` asks for an exit code for "coverage failure". The check
exists: `ubq uncovered` exits with 1 if it lists code (D51), and
`ubq uncovered --diff` does the same for the changed lines. A CI
job can use it.

The gap is in the run of the tests. Its text and its exit code
say nothing of coverage. An agent sees the code that its change
did not test only if it remembers to run `ubq uncovered`.

Options:

1. No change. The guide and the skill tell agents to run `ubq
   uncovered --diff` after a change.
2. A run of tests ends with a line such as `uncovered: 3 ranges
   in changed lines. List: ubq uncovered --diff`, if there are
   some. The exit code does not change.
3. 2, and the exit code is 1 if there are some.

The agent would pick 2. The line puts the fact in front of the
agent at the time it reads the result, with the command for the
details. With 3, a pass of all tests would exit with 1, and the
last line would not tell the full truth.

Points for 2 and 3: the run starts `git` (today it does not,
D41). A run of part of the tests gives part of the coverage, so
the line is only for a run of all tests, or it names the files
that the run loaded.

## Q15. A seeded random source, and a free port (9)

`01` asks for a seeded random source and a fixture for free
ports. ubq has neither. A server can listen on port 0 and read
its port, so a port fixture saves little.

Options:

1. Neither. Document `listen(0)` in the guide.
2. A `random(seed?)` export that gives a seeded generator, with
   the seed in the failure report.
3. 2, and `Math.random` takes the seed of the run in each test.

The agent would pick 1 and 2.

## Q16. Capture of network requests, child processes, and files (10)

`01` asks for built-in capture of these side effects. Today a
test uses `spyOn(globalThis, 'fetch')`, `mockImport` of
`node:child_process` or `node:fs`, or `testdir`.

Options:

1. No more API. The guide shows the three forms above.
2. A `captureFetch()` fixture that records each request, and
   gives a reply from a table. It goes away when the test ends.
3. 2, and the same for child processes.

The agent would pick 1. A wish for more comes from a real
project.

## Q17. One command for each runtime (11)

`01` asks for a matrix run that reports which runtime failed.
Today a person runs `ubq` on each runtime, and `ubq merge` joins
the coverage.

Options:

1. No command. CI makes the matrix.
2. `ubq --runtimes node,bun,deno` runs each file on each runtime
   that is installed, and the summary names the runtime of each
   failure.

The agent would pick 2 only if users ask for it. Its cost is
three times the run.

## Q18. A test that adds no coverage (6)

`01` says that a test which runs no code that other tests do not
run is a sign of a weak test. The store has the data for this.

Options:

1. Nothing.
2. A command, such as `ubq weak`, that lists such tests. It is a
   hint, not a failure.

The agent would pick 2, after the tasks in `07-status.md`.

## Q19. "What runs now?" during a run (3)

`01` asks to read partial results while a run is in progress, and
to ask what runs now and for how long. The store gets its rows
while the run goes on, so `ubq failures` and `ubq sql` can read a
run in progress. No command shows the files that run now.

Options:

1. Nothing. An agent waits for the run.
2. `ubq status`: the run in progress, its files that ended, the
   files that run, and the time of each.

The agent would pick 2.

## Q20. A check of the globals after each test (9)

`01` asks for a check that a test left the globals and the
listeners as it found them. D29 says no: libraries set globals and
add listeners at their first call, so such a check fails tests
that did nothing wrong.

Options:

1. Keep D29. No check.
2. Check only the properties of `globalThis` that existed before
   the test: a test that replaces or removes one, and does not put
   it back, fails (kind `leak`), and ubq puts it back. A new
   global and a new listener are not checked. This catches
   `globalThis.fetch = fake` with no `cleanup`, and `spyOn` already
   puts its change back.
3. Option 2, and new globals too.

The agent would pick 2. It keeps the reason of D29, because a
library adds a global and does not replace one.
