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
to Q58 are D124. The answer to Q59 is D125. The answers to Q60 to
Q63 are D127. The answer to Q64 is D128.

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

## Open Questions

## Q65. A config key that fails a run with less than full coverage

**Blocked:** tap fails a run below 100% coverage. ubq has no such
setting. The report added `"posttest": "ubq uncovered"`, and asks
for a key such as `"coverage": "full"`, so that `ubq` alone is
enough in CI. A policy is a config key, not a flag.

- (a) No key. The convert guide now names the `posttest` script.
- (b) `"coverage": "full"`: after a run of all tests that passed,
  the run fails if `ubq uncovered` would list code. A run of some
  tests does not check.

The agent would do (b). It is one key with one value, and `ubq
check` already does the same work for changed lines.

## Q66. `erasableSyntaxOnly` as a FIX of `ubq doctor`

**Blocked:** `ubq doctor` gives a `FIX` for a tsconfig without
`"erasableSyntaxOnly": true`. The report says that the tests ran
without it, and that a change to the build config is a warning.
The doctor already reads each TypeScript file with the function of
Node that removes types: if a file has syntax that Node cannot
run, it names the file. The option only stops new such syntax in
the type check.

- (a) Keep the `FIX`.
- (b) A `note`, which is not a problem and does not set the exit
  code.

The agent would do (b), because the doctor finds the real problem
itself.

## Q67. `ubq convert` compares new snapshots with `tap-snapshots/`

**Blocked:** the text of a ubq snapshot is not the text of tap.
The report wrote a script that loads both files and compares the
values. ubq could do this: after `ubq --update`, a command or a
`ubq doctor` check that reads `tap-snapshots/`, and names each
entry with a different value. The keys of tap and ubq are not the
same (tap: `TAP > name > message 1`), and the values of tap are
text, so the check compares text after some changes, not values.

- (a) No such check. The convert guide says to read the new files.
- (b) A check in `ubq doctor`, while `tap-snapshots/` is there.

The agent would do (a) for now: the check is a large part of code
for one step of one conversion.

## Q68. One TODO of a kind for each file of `ubq convert`

**Blocked:** `ubq convert` writes the full text of a TODO the
first time, and a short form at each later place in the file. The
report says that the comments are long and repeat, and asks for
one TODO of each kind for each file, with a list of the lines.

- (a) Keep a TODO at each place. An agent goes to each place, and
  the comment is there.
- (b) One full TODO at the top of the file, with the lines, and a
  short `TODO(ubq): see the top of the file` at each place.

The agent would keep (a): the text at the place is what an agent
reads when it changes that line.

## Q69. "One small API" on the home page

**Blocked:** the report says that the API has about 20 exports,
so "one small API" is not quite correct. No change is needed for
the code.

- (a) Keep the text.
- (b) "One import": the claim that the report agrees with.
