# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

The answers to Q1 to Q6 are D25 (step 3) and D26 to D31. The
answer to Q7 is D38. The answer to Q8 is D39. The answer to Q9 is
D45. The answer to Q10 is D48. The answers to Q11 are D49 and D50.
The answer to Q12 is D57.

## Q13. A change that a crash or a stop "kills" in `ubq mutate`

`ubq mutate` counts a change as killed if a test fails, or if the
test process has a file error. A file error can come from the
change (a loop that does not end, a stack overflow), or from the
machine or the runtime (a crash of Bun, a stop on a slow machine).
In the second case the report is wrong: it misses a change that
no test catches.

`test/mutate.test.ts` failed one time in CI on Bun 1.4.4 for a
reason of this kind (see `07-status.md`). The cause is not known.

Options:

1. Keep this. A real gap can stay out of the report, rarely.
2. If only a file error or a timeout killed a change, run the
   same tests with the same change one more time. The change is
   killed only if it fails again. Cost: one more run for such a
   change, and a change that makes a loop runs into the time
   limit two times.
3. As 2, and also run the tests with no change. If they fail with
   no change, the report names the change as "not known".

The agent would pick 2: it costs time only for the rare change
that a file error kills, and a real loop or crash happens again.
