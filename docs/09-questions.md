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
is D66. The answer to Q21 is D83. The answer to Q22 is D80. The answer to Q24 is D82. The answer to Q25 is D81. The answer to Q26 is D84. The answer to Q23 is D85. The answer to Q17 is D86. The answer to Q27 is D87. The answer to Q28 is D88. The answer to Q29 is D89. The answer to Q30 is D90. The answer to Q31 is D91. The answer to Q32 is D92. The answer to Q33 is D93. The answer to Q34 is D94. The answer to Q35 is D95. The answer to Q36 is D103. The answer to Q37 is D102. The answer to Q38 is D104. The answer to Q39 is D107. The answers to Q40 and Q43 are D109. The answer to Q42 is D110.

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

## Q41. Source that Node cannot run: decorators, `enum`, metadata

Node removes types and changes nothing else. A NestJS project
has decorators (a syntax error in Node), `enum`, and
`emitDecoratorMetadata`, which needs the types at run time. Such
a project cannot run its tests on Node with ubq. On Bun it runs,
with faults of Bun that the project must work around (313 source
files with a type import in a constructor with decorators).

1. No change. Node runs erasable syntax, and Bun runs the rest
   (D79). `ubq doctor` also names decorators (not done yet).
2. A transform in the load hook of ubq for files with such
   syntax, with the compiler of the project (`typescript`
   `transpileModule`). It is slow (about 1 ms for each small
   file, and no type-aware output: `emitDecoratorMetadata` works
   for one file at a time, as ts-jest with `isolatedModules`
   does). The counters cache would hold the result, so a file
   costs this one time. The positions of the output are not the
   positions of the source: coverage and stack traces need a
   source map for these files.
3. The same with a faster compiler that the project installs
   (`@swc/core`, as the experiments folder has): one more
   dependency, and a second compiler with its own faults.

The agent would do 1 now, and 2 only if a second project needs
it: 2 is the transform that D92 refused, with a real cost in
positions. The report says that the type import fault of Bun is
worth a fix in the project in each case.

## Q44. A record of what `ubq convert` decided

The user asked, with the answer to Q42: "maybe there should be a
`.ubq/CONVERT.md` that records all the decisions it makes?"

`ubq convert` prints its report (each TODO with its place, the
hints, the notes) and does not keep it. `.ubq/` is not in git.

1. No file. The TODO comments in the code and the config that
   ubq writes (`tsconfig.ubq.json`, with a comment) are the
   record.
2. `ubq convert` writes its report to a file that the project
   can commit, and removes it from the list when each TODO is
   done.

The agent would do 1: a second place for the same facts gets
old, and the TODO comments are at the code that they are about.

