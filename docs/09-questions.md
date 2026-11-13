# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

The answers to Q1 to Q6 are D25 (step 3) and D26 to D31. The
answer to Q7 is D38. The answer to Q8 is D39. The answer to Q9 is
D45. The answer to Q10 is D48. The answers to Q11 are D49 and D50.

## Q12. A fake timer with a time of 0, or less than 0

The user decided that `setInterval(fn)` with no time, or with a
time that is not a finite number, runs as with 1 ms. That is done.

Node does the same for each time below 1 ms, and for `setTimeout`
too. `setTimeout(fn)`, `setTimeout(fn, 0)`, `setTimeout(fn, -5)`,
and `setInterval(fn, 0)` all wait 1 ms in Node.

The fake clock now does this:

| Call | First call at | Then |
| --- | --- | --- |
| `setInterval(fn)`, `NaN`, `'5'`, `Infinity` | 1 ms | each 1 ms |
| `setInterval(fn, 0)`, or a time below 0 | 0 ms | each 1 ms |
| `setTimeout(fn)`, `setTimeout(fn, 0)`, a time below 0 | 0 ms | |
| `setTimeout(fn, NaN)`, `'5'` | 0 ms, and 5 ms for `'5'` | |

Options:

1. Keep this. `tick(0)` runs a `setTimeout(fn, 0)`, which a test
   can find easy to read.
2. Do as Node for all timers: a time below 1 ms, or not a finite
   number, is 1 ms. A test that calls `tick(0)` for a
   `setTimeout(fn, 0)` must then call `tick(1)`.
3. Do as Node for `setInterval` only.

The agent would pick 2: a fake clock that does what Node does
gives no surprise when the test runs with real timers. It can
break tests of users that call `tick(0)` now.
