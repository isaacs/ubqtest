# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

## Q1. Fake clock and snapshots: no design yet (step 7)

**Blocked:** the fake clock and snapshots. `05-api.md`, section
11, says that each needs its own design, and the API document is
"accepted", so a new API needs the user.

**Options for the fake clock.**

- A fixture: `const clock = fakeClock()` in a test, with
  `clock.tick(ms)` and `clock.set(date)`. The real timers come back
  when the test ends, as for `spyOn`. This fits the rules of
  section 2 (a test contains all that it needs).
- A test option: `test(name, { clock: 'fake' }, fn)`.

The agent would make the fixture. Open point: which functions it
replaces (`setTimeout`, `setInterval`, `setImmediate`, `Date`,
`performance.now`), and if the time limit of the test uses the
real clock (it must).

**Options for snapshots.**

- `assert.snapshot(value)`, with one file for each test file in a
  folder next to it. An update needs a flag (`ubq --update`) and
  an explicit list of tests (`01`, section 7).
- No snapshots: `assert.equal` with a text in the test, and the
  tool prints the new text for a paste.

The agent has no preference with enough reasons. `01`, section 7,
wants the first, with strict rules for the update.

## Q2. Run records with the git commit: a cost in speed (step 6)

**Blocked:** `01`, section 3, wants each run record to have the
git commit and "whether the tree had changes".

The commit is cheap: a read of `.git/HEAD` and one ref file. The
state of the tree needs `git status`, which takes 5 ms or more,
and much more in a large repository. The budget for one file is
58 ms.

**Options.** (a) The commit only. (b) Commit and tree state, with
`git status` in parallel with the tests in a run of many files,
and not at all in a run of one file. (c) Neither: the content
hashes of the loaded files (`test.code`) already tell if two runs
ran the same code.

The agent would do (a).

## Q3. `--baseline`: exit code, place of the checkout, kept results

D26 records what the agent chose. The user can change each point.
Not blocked.

## Q4. Source counters on Node, step 3 of D25

The runner still uses V8 on Node. D25 says that the switch waits
"until the comparison has run for some time with no new
difference". The user decides when that time is over. Not started.

## Q5. Random test order: the default, and the scope (step 7)

**Blocked:** random order with a seed. `01`, section 9, wants
random order by default, with the seed in the run record and in
each failure report. `05-api.md`, section 3, says only that "a
later step adds random order with a seed".

**To decide.**

- Is random order the default, or an option (`ubq --random`)? As
  the default, the order of the failure blocks changes from run to
  run, and each failure block gets a line with the seed.
- What moves: the tests in a file, or the tests in each `describe`
  group only (the groups keep their order)?
- A plain `node test/file.ts` run: random too, or the order of the
  file?

The agent would do: default on under `ubq` and in a plain run,
tests move in the full file, `ubq --seed <n>` repeats an order, and
`rerun:` lines include the seed. The tests of this repository
compare output text, so they would set a seed.

## Q6. Leak checks after each test: cost and strictness (step 4)

**Blocked:** the check that a test left the process as it found it
(`01`, section 9): environment variables, working directory,
globals, listeners.

**Measured (Node 24, this machine):** a copy of `process.env` with
173 variables takes 0.23 ms. A check for each test needs one copy
for each test. `process.cwd()` takes 0.0001 ms, and the list of the
names of the globals 0.01 ms.

**To decide.**

- Is 0.1 to 0.25 ms for each test acceptable for the environment
  check? The other three checks are almost free.
- Is a leak a failure of the test (D2), with no opt-out? A library
  that sets a global or a variable at its first call would fail the
  first test that calls it. The fix for the user is to call it at
  the top level of the file.
- Listeners of `process`: libraries add these at their first call
  too (`signal-exit`).

The agent would do: working directory and environment as failures,
and put the old values back so that later tests are not affected.
Globals and listeners not yet.

