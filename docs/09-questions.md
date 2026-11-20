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
is D66. The answer to Q21 is D83. The answer to Q22 is D80. The answer to Q24 is D82. The answer to Q25 is D81. The answer to Q26 is D84. The answer to Q23 is D85. The answer to Q17 is D86. The answer to Q27 is D87. The answer to Q28 is D88. The answer to Q29 is D89. The answer to Q30 is D90. The answer to Q31 is D91. The answer to Q32 is D92. The answer to Q33 is D93. The answer to Q34 is D94. The answer to Q35 is D95. The answer to Q36 is D103. The answer to Q37 is D102. The answer to Q38 is D104. The answer to Q39 is D107. The answers to Q40 and Q43 are D109. The answer to Q42 is D110. The answer to Q41 is D111. The answer to Q44 is D112. The answers to Q45, Q46, and Q47 are D114. The answer to Q48 is D115. The answers to Q49 and Q50 are D117.

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

Q49 and Q50 came from `21-whosonfirst.ai-feedback-0.0.19.md`.

Q51 and Q52 come from `22-glob-fable-feedback-0.0.19.md`. D119 has
what is done.

## Q51. A place for a warning of a test that passes

The report has a test that compares two tools. A difference was a
`todo` in tap: shown, and not a failure. In ubq the agent wrote
`console.error` and an assertion that is always true. The output
of a test that passes is not shown, so "a warning that only `ubq
show` prints is a warning that nobody reads". The reporter does
not ask for `todo`. The reporter asks for one line in the
summary, such as `1 test wrote to stderr`, or a `note()`
function.

1. No change. A check that can fail is an assertion, and a check
   that cannot fail is not a check.
2. A `note(text)` function. The run prints each note of a test
   that passes, as it prints each skip with its reason: `note
   file > test: text`.
3. One more part in the last line: `2 tests wrote to stderr`,
   with `ubq show` for the text.

The agent would do 1. A design goal of ubq is short output: a
line that each run prints, for a thing that is not a failure,
is the noise that ubq leaves out. A skip with a reason
(`skip()`, D117) is the honest form if the test cannot give a
result. 3 would also be wrong for the many programs that write
progress to stderr.

## Q52. A snapshot of a short array has columns

A snapshot of an array of short strings has the layout of
`util.inspect`, with more than one element on a line:
`'x/x/a',   'x/x/x/a',`. A change of one element then changes a
line with other elements, and the diff is hard to read.

1. No change.
2. One element on each line, for each array. Each stored
   snapshot with such an array then fails until `ubq --update`
   writes it again.

The agent would do 2 before more projects have snapshots: the
diff of a snapshot is what a person reads in a review. It is a
change that breaks stored snapshots, so it is a decision for the
user.
