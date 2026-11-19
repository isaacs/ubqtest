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
is D66. The answer to Q21 is D83. The answer to Q22 is D80. The answer to Q24 is D82. The answer to Q25 is D81. The answer to Q26 is D84. The answer to Q23 is D85. The answer to Q17 is D86. The answer to Q27 is D87. The answer to Q28 is D88. The answer to Q29 is D89. The answer to Q30 is D90. The answer to Q31 is D91. The answer to Q32 is D92. The answer to Q33 is D93. The answer to Q34 is D94. The answer to Q35 is D95. The answer to Q36 is D103. The answer to Q37 is D102. The answer to Q38 is D104. The answer to Q39 is D107. The answers to Q40 and Q43 are D109. The answer to Q42 is D110. The answer to Q41 is D111. The answer to Q44 is D112. The answers to Q45, Q46, and Q47 are D114.

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

Q45 to Q48 come from `private/22-vitest-monorepo-feedback-0.0.19.md`
(not public). D113 has what is done.

## Q48. `SELF` for the tests of a Worker

The integration tests of the report drive the Worker with
`SELF.fetch(request)` of `cloudflare:test`, and none of them
loads: "No such module". The guide says to call the handler with
a Request. For these tests that is a new design, not a change of
a name. The other Workers support worked the first time.

1. No change.
2. `ubqtest/workers` exports a function that sends a request to
   the Worker of the wrangler config, in the same isolate, as
   `SELF.fetch` does. `ubq convert` changes the import.

The agent would do 2. It is the largest block of the report, and
the name of one import is the difference for most of those
files. The agent must first measure what `SELF` of vitest does
that a call of the default export does not (the same isolate,
the bindings, `ctx.waitUntil`).
