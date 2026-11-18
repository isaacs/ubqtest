# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

The answers to Q1 to Q6 are D25 (step 3) and D26 to D31. The
answer to Q7 is D38. The answer to Q8 is D39. The answer to Q9 is
D45. The answer to Q10 is D48. The answers to Q11 are D49 and D50.
The answer to Q12 is D57. The answer to Q13 is D58. The answer
to Q14 is D61. The answers to Q15, Q16, Q18, and Q20 are D60. The answer to Q19
is D66. The answer to Q21 is D83. The answer to Q22 is D80. The answer to Q24 is D82. The answer to Q25 is D81. The answer to Q26 is D84. The answer to Q23 is D85. The answer to Q17 is D86. The answer to Q27 is D87. The answer to Q28 is D88. The answer to Q29 is D89. The answer to Q30 is D90. The answer to Q31 is D91. The answer to Q32 is D92. The answer to Q33 is D93. The answer to Q34 is D94. The answer to Q35 is D95.

Q14 to Q20 come from the wants in `01-agent-ideation.md` that the
code does not have yet. The section of that file is in brackets.

Q21 to Q26 come from `19-sonnet-feedback-0.0.16.md`: a conversion
of 167 vitest files of sentry-javascript `packages/core` by eight
agents on a smaller model. "N of 8" is the count of agents that
hit the problem.

Q27 to Q35 come from the same report. They are the points that
D78 to D86 did not decide.

Q36 to Q38 come from `20-seldo-feedback-0.0.18.md`. They are the
points that D98 to D101 did not decide.

## Q36. `ubq check` and a changed file that no test can load

`ubq check` fails for a changed code file that no test loads. A
project can have a file that no test can load, such as the entry
of a browser Web Worker. The stop hook of `ubq skill` then blocks
an agent on a problem that it cannot correct. In the report, the
change was a type cast, which makes no JavaScript.

1. Exempt a change of only types: compare the JavaScript of the
   file at the commit and now, with the types removed.
2. A key or a comment that says "no test can load this file",
   as `// ubq: not measured:` does for a range.
3. No change. The user adds the file to `"build"`.

The agent would do 2: it is the same idea as `not measured`, it
is visible in review, and it also covers a real change to such a
file. 1 is narrow, and needs Node to remove the types.

## Q37. The values of `assert(a >= b)` in a failure

`assert.greaterThan` and `assert.lessThan` show the two values
(D99). `>=` and `<=` have no assertion, so `ubq convert` writes
`assert(a >= b)` for `toBeGreaterThanOrEqual`, and a failure
shows only `false`.

1. Two more assertions: `assert.atLeast(value, target)` and
   `assert.atMost(value, target)`.
2. No change: fewer ways.

The agent would do 2 until a report asks for it. The report had
178 `toBeGreaterThan` and 77 `toBeLessThan`, and did not count
the other two.

## Q38. A CI job for Node 22

ubq runs on Node 22.18 or later (D100), and CI tests Node 24 and
the newest Node. On Node 22.22, 6 of the tests of this repository
fail: a test file with `using` syntax, the `require` limit of
D100, a difference in what V8 reports for coverage, and the text
of two error messages.

1. Change or skip those tests on Node 22, and add a CI job.
2. No job. The docs say that Node 22.18 works, with no test in CI.
3. Say Node 24 in the docs again, and keep the workarounds.

The agent would do 1: a stated requirement with no test goes
wrong with time.
