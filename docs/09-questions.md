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
Q63 are D127.

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

## Open Questions

Q64 comes from the answer of the user to those reports.

## Q64. Built-in predicates for a pattern, and one for "an array that has these elements"

**Blocked:** `expect.arrayContaining([a, b])` has no form in a
pattern: an array in a pattern has the length of the value. `ubq
convert` writes one `assert.contains` for each literal, and a
TODO for each other case. In the two reports of a bun:test
project, the agents wrote a `find` with a hand-picked key at 53
places. The user: "It feels like we're doing a lot of work to
avoid adding an arrayContaining-style matcher. It seems like
something we could implement for patterns with a built-in
predicate, like `any.number`, no?"

A predicate is a function, so ubq can export functions that make
one, with no new rule for patterns. D85 left such exports out
("an export for each common case is a second way to do one
thing"), and said that they can come later, on top of the
function. Three points need a decision.

**1. Which predicates.**

- (a) Only the one for arrays.
- (b) Also the type checks that `ubq convert` now writes as
  functions: `any.number` in place of `(v: unknown) => typeof v
  === 'number'`. This is a second way to write them, and it
  changes D85. The converter output gets much shorter.

**2. The name and the place.** One object keeps the names out of
the way of the names of a test file. A sketch, with `any` as the
name of the user:

```ts
import { any, assert } from 'ubqtest'

assert.matchOnly(event, { id: 1, time: any.number, tags: any.arrayWith('a', /^b/) })
assert.match(res, { rows: any.arrayWith({ id: 7 }) })
```

`any.number`, `any.string`, `any.boolean`, `any.bigint`,
`any.symbol`, `any.function`, `any.object`, `any.array`,
`any.defined` (not null and not undefined, the `anything` of
jest), `any.instanceOf(Class)`, and `any.arrayWith(...patterns)`.

**3. How `arrayWith` compares an element.** Each argument is a
pattern, and the array must have an element that matches it.

- (a) By the rules of `match`: an object is partial. `rows:
  any.arrayWith({ id: 7 })` does the work of
  `toContainEqual(objectContaining({ id: 7 }))`, the most
  frequent form of the reports (about 100 places). An exact
  element then needs a function with `isDeepEqual`.
- (b) By the rules of the assertion around it: partial in
  `match`, no other keys in `matchOnly`. A predicate does not
  know its assertion now, so this needs a new rule.

**The agent would do:** 1 (b), the object `any` of the sketch,
and 3 (a). The evidence of four reports is that agents do not
like to write the function, and that they write a helper file for
it. With 3 (a), one rule covers the form that the reports have
most. `ubq convert` then writes `any.number` for
`expect.any(Number)`, and `any.arrayWith(...)` for
`expect.arrayContaining([...])`.
