# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

## Q1. Snapshots

Decided (2026-11-12), not built yet: `assert.snapshot(value)`, with
one file for each test file, as in tap, and an explicit `--update`
flag. (The fake clock is built: D30.)

## Q4. Source counters on Node, step 3 of D25

Decided (2026-11-12), not built yet: switch the runner to
counters now. V8 stays in the code, so that a switch back is
possible.
