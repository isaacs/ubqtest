# Handoff

For a coding agent that picks up this project with no memory of the
earlier sessions. Written on 2026-11-11, when the repository moved
from a folder named `nextap` to a folder that matches the package
name. Delete this file when it is out of date.

## What this is

`ubqtest` is a test framework for coding agents who write
TypeScript, and their humans. The package is `ubqtest`. The
executable is `ubq`. The remote is `git@github.com:isaacs/ubqtest.git`.

## Read these first, in this order

1. `docs/README.md`: the index of all documents.
2. `docs/07-status.md`: what is built, by step, with commands, a
   source file map, and known limits.
3. `docs/02-decisions.md`: decisions D1 to D22. A decision there
   overrides the older documents.
4. `docs/04-architecture.md`: the plan. Section 13 is the build
   order. Section 12 is speed.
5. `docs/05-api.md`: the test file API, accepted by the user.

## State

- Steps 0 to 5 of the build order are done and committed on `main`.
- Step 4 lacks hang reruns (D14). Step 5 lacks mocks and hang
  stacks on Bun.
- The speed targets are not met: 54 ms for one file (target 45),
  917 ms for 200 files (target 650). `docs/04-architecture.md`,
  section 12, has the breakdown.
- Nothing is pushed by the agent. The user pushes.

## After the move to a new folder

- Run `npm install` in the root if `node_modules` did not move.
- Run `npm install` in `experiments/` only if you need the
  benchmark against other frameworks.
- `test/setup.ts` makes the link `test/fixtures/node_modules/ubqtest`
  again when it is wrong. No manual step.
- `.ubq/` folders (run stores, compile cache) are safe to delete.
- No tracked file contains an absolute path.
- The agent memory of the old folder does not move. The section
  "How the user wants the work done" below has its content.

## Checks before each commit

```
npx tsc                 # must print nothing
node src/cli.ts test    # the tool runs its own tests: 49 pass
npm run bench -- --only ubq --check   # speed guards (builds first)
```

The suite needs `bun` and `deno` on the path for all tests. A test
skips itself, with a reason, if its runtime is not installed.

If a test fails, `node src/cli.ts failures` prints the failures of
the last run again, and `node src/cli.ts failures <run>` prints an
older run.

## Open question for the user

Should Node use source counters in place of V8 coverage snapshots?
The instrumenter exists (`src/instrument.ts`, D22). A V8 snapshot
costs 0.43 ms for each test, and a counter snapshot costs
microseconds. The agent recommended a small experiment first: a
Node preload with a `module.registerHooks` load hook that calls
`instrument`, then the 200-file benchmark. The user has not
answered. Do not change D5 without the answer.

## Next work, in order

1. If the user says yes to the experiment above: do it, and record
   the numbers in `docs/03-measurements.md`.
2. Step 6: test IDs as command arguments, `--failed`, `--changed`,
   `diff`, `history`, `--repeat`, `--baseline`. The store needs a
   content hash for each source file (`--changed` compares it).
3. Step 7: `mockImport` (proven in `experiments/api/mock-rt.ts` and
   `experiments/hooks/`), `spy`, `spyOn`, `testdir` (D18), `env`,
   `cleanup`, fake clock, snapshots, random order with a seed.
4. Hang reruns (D14): run a timed-out test again with an
   `async_hooks` init hook, to get the line that opened each
   resource. `experiments/hang/report.mjs` shows the method.
5. Step 8: agent guide in the package, `doctor`, type checks, Deno
   parity, one small bundle.

## How the user wants the work done

- Do the next known step without a wait for "go". Stop only for a
  decision that is the user's to make.
- Commit at each good savepoint, in atomic chunks, on `main`. The
  history must show how the code got to its state. Do not push.
- Record each decision in `docs/02-decisions.md`, and each finished
  step in `docs/07-status.md`.
- Measure before a design choice. Put the script in `experiments/`
  and the number in `docs/03-measurements.md`.
- Report results plainly, with what failed and what is not done.
- The user's global instructions set the prose style: Simplified
  Technical English, short sentences, American spelling, no
  em-dash, comments wrapped at 75 characters.
- The user wrote node-tap. They accepted an API with no `t` object
  and no subtests, for the reasons in D15 and D16.

## Things that cost time before

- A command that can hang must run under `timeout`. A wedged test
  process once ran until the tool call timed out.
- A test process that starts child processes must not pass
  `UBQ_*` variables on. The library removes them when it loads.
- Two test files must not share one fixture store. Test files run
  in parallel. `test/bun.test.ts` works on a copy of the coverage
  fixture for this reason.
- A change to a sink must not throw on a closed pipe. An error
  handler that writes to the same pipe makes a loop.
- The benchmark guards catch real regressions. A watchdog thread
  in each child added 300 ms to the 200-file run before the guard
  showed it.
- The machine gets slower during long sessions (Node start went
  from 28.7 ms to 31.3 ms). Compare against `node -e 0` on the
  same day.
