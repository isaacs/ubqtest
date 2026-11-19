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
is D66. The answer to Q21 is D83. The answer to Q22 is D80. The answer to Q24 is D82. The answer to Q25 is D81. The answer to Q26 is D84. The answer to Q23 is D85. The answer to Q17 is D86. The answer to Q27 is D87. The answer to Q28 is D88. The answer to Q29 is D89. The answer to Q30 is D90. The answer to Q31 is D91. The answer to Q32 is D92. The answer to Q33 is D93. The answer to Q34 is D94. The answer to Q35 is D95. The answer to Q36 is D103. The answer to Q37 is D102. The answer to Q38 is D104. The answer to Q39 is D107.

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

Q40 to Q43 come from `21-nest-jest-feedback-0.0.18.md`. D108 has
what is done.

## Q40. A spy with a result that the test changes

D87 said no new spy API. This report asks again, with more
weight: each converted file made its own helper of 10 to 20
lines (`controllable()`, `setup(impls)` with `resolves`,
`rejects`, and `inOrder`), and a suite of 870 lines with shared
mocks was hard to convert. The user named this as a gap: "a
better answer for some of jest's affordances".

1. No change (D87). The guide has the forms: a variable that the
   implementation reads, and `spy(() => results.shift())`.
2. One function for the most frequent case, a list of results in
   order: `spy.results(a, b, c)` gives `a`, then `b`, then `c`
   each next call. `spy.results(Promise.resolve(a))` is a result
   that is a promise. An Error instance in the list is thrown.
3. A spy whose implementation the test can replace:
   `s.impl = () => 2`. This is `mockImplementation` with a
   different name, and makes a spy a thing with state.

The agent would do 2: one function, no state to reset, and it
covers `mockReturnValueOnce`, `mockResolvedValueOnce`, and
`mockRejectedValueOnce`, which are most of the chains in the
report. 3 brings back the shared mock that a hook resets.

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

## Q42. A type check for a project with references (`tsc -b`)

ubq runs `tsc -p <tsconfig.json> --noEmit` for each folder with
a test file. A project of Nx has a `tsconfig.json` with only
`references`, and that command reads no file. D108 gives a FIX
line in `ubq doctor` with a config to add. The reporter needed
five tries for one app: `composite`, stale `dist/*.d.ts` of
referenced projects, and `isolatedModules` each gave errors.

1. No change: the FIX line, and the user makes a config.
2. For a config with only references, run `tsc -p` for each
   referenced config that has test files (`tsconfig.spec.json`),
   with `--noEmit --composite false`.
3. Run `tsc -b` for such a project. It writes build output, and
   it is slow the first time.

The agent would try 2 on a real project of Nx before it chooses.
It has none on this machine.

## Q43. `toHaveBeenCalledWith` with one check: the last call, or any call

`ubq convert` changes one `toHaveBeenCalledWith` of a spy to a
check of its last call, and more than one to a check of any call
(`calls.some(...)`). jest passes if any call has the arguments.
In the report, a converted test failed: the call that matched
was not the last one.

1. No change. The check of the last call is more exact, and a
   failure shows the arguments.
2. Each check becomes `calls.some(...)`: the same result as jest
   in each case, and a failure shows only `false`, with the
   values of the `isDeepEqual` calls below it (D91).

The agent would do 2. The command must keep a test that passed
correct, and 1 can fail a correct test.
