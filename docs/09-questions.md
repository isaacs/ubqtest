# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

## Q70. A type assertion in place of `expectTypeOf`

From `25-hermetic-feedback-0.0.23.md`. ubq has no assertion of a
type, so `ubq convert` leaves `expectTypeOf` with a TODO, and the
agent of the report removed five checks. Each run of ubq checks
the types, so a type assertion can be a function whose type fails
the check, and does nothing when it runs.

- (a) `assert.type<Expected>(value)`: a compile error if the type
  of `value` is not exactly `Expected`. At run time, it counts as
  an assertion and does nothing. `convert` writes it for
  `expectTypeOf(x).toEqualTypeOf<T>()`.
- (b) A separate export, `assertType<Expected>(value)`, outside
  `assert`.
- (c) None: the guide says to keep type checks in a `.ts` file
  that the type checker reads.

The agent would do (a): it is one more name on `assert`, and an
exact type is what `toEqualTypeOf` checks.

## Q71. `toEqual` and a key with the value `undefined`

From the same report. `toEqual` of vitest ignores a key with the
value `undefined`. `ubq convert` writes `assert.deepEqual`, or
`assert.matchOnly` for a value with a matcher, and both count such
a key (D2). 7 tests of the report failed for this reason.
`assert.match` passes, but permits each other extra key too.

- (a) No change of the assertions. When a failure of `deepEqual`
  or `matchOnly` has only differences of the form `actual:
  undefined, expected: (missing)`, it gets a hint: remove the key
  from the value, or add it to the expected value with
  `undefined`.
- (b) `matchOnly` ignores a key of the value whose value is
  `undefined`, if the pattern does not have the key.
- (c) `convert` writes a TODO at each `toEqual` with an object.

The agent would do (a): the rule of D2 stays, and the failure
tells the fix.

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
to Q58 are D124. The answer to Q59 is D125. The answers to Q60 to
Q63 are D127. The answer to Q64 is D128. The answers to Q65 to
Q69 are D130.

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

Q60 to Q63 came from `private/ubq-feedback-0.0.19.md` and
`private/ubq-feedback-0.0.22.md` (not public). D126 has what is
done for the rest of those reports.

Q64 came from the answer of the user to those reports.

Q65 to Q69 came from `24-minimatch-feedback-0.0.24.md`. D129 has
what is done for the rest of that report.

Q70 and Q71 came from `25-hermetic-feedback-0.0.23.md`. D132 has
what is done for the rest of that report.
