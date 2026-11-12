# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

The answers to Q1 to Q6 are D25 (step 3) and D26 to D31. The
answer to Q7 is D38.

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
