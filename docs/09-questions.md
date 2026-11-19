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
is D66. The answer to Q21 is D83. The answer to Q22 is D80. The answer to Q24 is D82. The answer to Q25 is D81. The answer to Q26 is D84. The answer to Q23 is D85. The answer to Q17 is D86. The answer to Q27 is D87. The answer to Q28 is D88. The answer to Q29 is D89. The answer to Q30 is D90. The answer to Q31 is D91. The answer to Q32 is D92. The answer to Q33 is D93. The answer to Q34 is D94. The answer to Q35 is D95. The answer to Q36 is D103. The answer to Q37 is D102. The answer to Q38 is D104. The answer to Q39 is D107. The answers to Q40 and Q43 are D109. The answer to Q42 is D110. The answer to Q41 is D111. The answer to Q44 is D112. The answers to Q45, Q46, and Q47 are D114. The answer to Q48 is D115.

Q14 to Q20 come from the wants in `01-agent-ideation.md` that the
code does not have yet. The section of that file is in brackets.

Q21 to Q26 come from `19-sonnet-feedback-0.0.16.md`: a conversion
of 167 vitest files of sentry-javascript `packages/core` by eight
agents on a smaller model. "N of 8" is the count of agents that
hit the problem.

Q27 to Q35 come from the same report. They are the points that
D78 to D86 did not decide.

Q36 to Q38 came from `20-seldo-feedback-0.0.18.md`.

Q39 came from the benchmark of `bench/`.

Q40 to Q44 come from `private/21-nest-jest-feedback-0.0.18.md`
(not public), and from the answers to it. D108 has what is done.

Q45 to Q48 came from `private/22-vitest-monorepo-feedback-0.0.19.md`
(not public).

Q49 and Q50 come from `21-whosonfirst.ai-feedback-0.0.19.md`.
D116 has what is done.

## Q49. A skip that the test decides while it runs

`skip` is an option: the reason is known when `test()` is called.
The report has a test that measures a page, and skips if the page
has no paragraph of three lines. To know that when the file
loads, the file opens each page first (56 page loads at the top
level).

1. No change. The condition is code at the top level, or the
   test passes with no check for that case, which the "no
   assertions" rule refuses.
2. A function for the test: `skip('reason')` ends the test as
   skipped, with the reason. `node:test` has `t.skip()`, and
   vitest has `ctx.skip()`. A test that calls it after an
   assertion failed is still a failure.

The agent would do 2. A skip with a reason is honest, and the
other form costs a top level that does the work of the tests.
The name can be a member of the test context: `test('x', ({
skip }) => ...)`.

## Q50. A check of the whole file that can fail as itself

`assert` in a `cleanup()` at the top level of a file is an
error: "assert was called outside a test". The helper of the
report throws an Error there. An error of a page after its test
ended is `1 errors` of the file, and the test that opened the
page is among the passed.

1. No change. A check that is not in a test is an error of the
   file.
2. `assert` works in a file-level `cleanup()`, and a failure
   there is an ERROR block of the file with the diff of the
   assertion.

The agent would do 2: the block is the same, and the diff is
better than the text of a thrown Error. It is not a new kind of
result.
