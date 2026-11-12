# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

The answers to Q1 to Q6 are D25 (step 3) and D26 to D31.

## Q7. Type checks next to tests: when, and with which exit code (2026-11-12)

Built, with the choices that the agent would make (`src/typecheck.ts`).
Nothing is blocked. A different answer changes two lines of
`src/runner.ts`.

**When does the type check run?**

- A. With each run of tests. Simple, but a type check of a large
  project takes seconds, and `ubq <file>:<line>` must stay fast
  (D11).
- B. With a run of all tests (`ubq` with no selection), and with
  `--types` for a smaller run. **Built.**
- C. Only with `--types`.

**What is the exit code of a run with type errors and no failed test?**

- A. 1, the same as a failed test. The summary starts with `fail`.
  **Built.**
- B. A code of its own, so that a script can tell the two apart.

The check runs only if the project has `tsconfig.json` in its root
and the `typescript` package. There is no option that turns it off
for a run of all tests (D2).

## Q8. Per-test coverage on Bun: what is the gap that blocks you? (2026-11-12)

Per-test coverage on Bun works under the runner, with source
counters. The gaps are: a plain `bun test/foo.ts` records none,
`.tsx` and `.jsx` files get no counters, and a file that the
parser cannot read gets none.

Bun 1.4.3 has precise coverage through `node:inspector`, but its
positions are not source positions, and a program cannot map them
(`03-measurements.md`, section 11). `10-bun-coverage-api.md` is a
proposal to Bun that asks for source positions.

Options:

- A. Keep counters. Send the proposal to the Bun project (an issue,
  then a patch). The agent has not sent it: that is a public post
  in your name. **The agent would do this.**
- B. Add a second collector on Bun that uses the inspector, for a
  plain program and for files with no counters. The positions
  come from a match of the tokens of the source with the tokens
  of Bun's JavaScript. This is a guess, and it can name a wrong
  line. It is against "correct with no setting".
- C. Work on a patch to Bun in a checkout of Bun.

If a feature that you have in mind needs more than the runner
gives on Bun, name it, and the answer can change.
