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
