# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

## Closed Questions

The answers to Q1 to Q6 are D25 (step 3) and D26 to D31. The
answer to Q7 is D38. The answer to Q8 is D39. The answer to Q9 is
D45. The answer to Q10 is D48. The answers to Q11 are D49 and
D50. The answer to Q12 is D57. The answer to Q13 is D58. The
answer to Q14 is D61. The answers to Q15, Q16, Q18, and Q20 are
D60. The answer to Q17 is D86. The answer to Q19 is D66. The
answer to Q21 is D83. The answer to Q22 is D80. The answer to Q23
is D85. The answer to Q24 is D82. The answer to Q25 is D81. The
answer to Q26 is D84. The answer to Q27 is D87. The answer to Q28
is D88. The answer to Q29 is D89. The answer to Q30 is D90. The
answer to Q31 is D91. The answer to Q32 is D92. The answer to Q33
is D93. The answer to Q34 is D94. The answer to Q35 is D95. The
answer to Q36 is D103. The answer to Q37 is D102. The answer to
Q38 is D104. The answer to Q39 is D107. The answers to Q40 and
Q43 are D109. The answer to Q41 is D111. The answer to Q42 is
D110. The answer to Q44 is D112. The answers to Q45, Q46, and Q47
are D114. The answer to Q48 is D115. The answers to Q49 and Q50
are D117. The answers to Q51 and Q52 are D121. The answers to Q53
to Q58 are D124. The answer to Q59 is D125.

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

Q51 and Q52 came from `22-glob-fable-feedback-0.0.19.md`. D119 has
what is done for the rest of that report.

Q53 to Q58 came from `23-sentry-core-feedback-0.0.22.md`. D123 has
what is done for the rest of that report.

Q59 came from the same report.

## Open Questions

Q60 to Q63 come from `private/ubq-feedback-0.0.19.md` and
`private/ubq-feedback-0.0.22.md` (not public). D126 has what is
done for the rest of those reports.

## Q60. A numeric assertion on a value that can be `undefined`

**Blocked:** `expect(x?.y).toBeCloseTo(1.5)` becomes
`assert.close(x?.y, 1.5)`, which is a type error: the value is
`number | undefined`. The same for `greaterThan`, `lessThan`, and
their two other forms. The project of the reports needed a `!` by
hand at 15 places, in each of its two conversions.

**Options:**

1. No change.
2. `ubq convert` writes `(x?.y)!` in a TypeScript file. Many
   projects have a lint rule against `!`.
3. The value of these assertions can be `undefined` or `null` in
   the type. At run time such a value fails, as it does now, and
   the report shows `actual: undefined`.

**The agent would do:** option 3. The assertion still fails for
a value that is not there, so the type error adds no safety. The
`!` only moves the same failure to run time, with more text.

## Q61. `ubq --changed` and a test that failed in its last run

**Blocked:** after a change that made 20 tests fail, and the
revert of that change, `ubq --changed` ran 18 tests and did not
select 3 of the tests that had failed. `ubq check` then failed,
and named `ubq --failed`. The 3 tests stop a child process with a
signal, so they had no coverage of the changed lines.

**Options:**

1. No change. `ubq check` names the command.
2. `ubq --changed` also runs each test that failed in its last
   run.

**The agent would do:** option 2. A test that failed stopped at
its failure, so its coverage is not complete, and the selection
by coverage cannot know if the change is for it. The run that the
agent expects to make things green then does.

## Q62. The `allowImportingTsExtensions` FIX for a project with no such import

**Blocked:** `ubq doctor` has a FIX line for a tsconfig without
`allowImportingTsExtensions`, with the reason "The guides import
files with the .ts extension". The project of the reports imports
each file with no extension (D78), so the option changes nothing
there. The agent of the two reports read the FIX as wrong for the
project.

**Options:**

1. No change.
2. The FIX only if a file of the project imports a relative path
   with a `.ts` extension. A test that an agent writes later from
   the guide, with `.ts`, then gets TS5097, and that error gets a
   hint that names the option.
3. A `note` line in place of the FIX.

**The agent would do:** option 2. A FIX that does nothing for the
project makes the other FIX lines less sure.

## Q63. A time limit for one file

**Blocked:** `setDefaultTimeout(30_000)` of `bun:test` sets the
limit for the tests of its file. ubq has the limit as an option
of `test` and of `describe`, and as the `timeout` key for the
project. A file whose 24 tests all drive real git needed the
option 24 times, or a `describe` around the whole file. `ubq
convert` now writes a TODO for the call.

**Options:**

1. No change.
2. `ubq convert` puts a `describe` with the option around the
   tests of the file. The diff then has each line of the file.
3. A function for the limit of the tests after it in the file.
   It is state that a test file sets, which ubq does not have
   now.

**The agent would do:** option 1. A constant with the option on
each test is plain, and it is one file of 83.
