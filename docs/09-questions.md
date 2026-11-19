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
is D66. The answer to Q21 is D83. The answer to Q22 is D80. The answer to Q24 is D82. The answer to Q25 is D81. The answer to Q26 is D84. The answer to Q23 is D85. The answer to Q17 is D86. The answer to Q27 is D87. The answer to Q28 is D88. The answer to Q29 is D89. The answer to Q30 is D90. The answer to Q31 is D91. The answer to Q32 is D92. The answer to Q33 is D93. The answer to Q34 is D94. The answer to Q35 is D95. The answer to Q36 is D103. The answer to Q37 is D102. The answer to Q38 is D104. The answer to Q39 is D107. The answers to Q40 and Q43 are D109. The answer to Q42 is D110. The answer to Q41 is D111. The answer to Q44 is D112.

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

## Q45. A run with no type check

Each run checks the types, and a type error fails the run (D38,
D49). The report: a conversion from `expect` gave many hundreds
of type errors, mixed with the test results, and no key turns
the check off. A change of test tool then also needs a change of
the types of the tests. The reporter asks for an option or a key
that turns the check off, with the check as a separate step of
CI.

1. No change. The type errors of a conversion are real: the old
   tool did not check the tests. A run of a selection already
   does not fail for the type errors of other files.
2. A key, `"types": false`: no run checks types. The project
   runs `tsc` itself.
3. An option of the command for one run, such as `ubq
   --no-types`. No key: a project cannot turn the check off for
   each run.

The agent would do 3. In a conversion, the agent must first see
which tests pass, and that many type errors hide it. A key (2)
makes it easy to leave the check off, which D38 is against.

The report also says that `assert.equal(actual, 'LITERAL')` is a
type error if `actual` is a union of strings. With the types of
D98, that is an error only if the union does not have the
literal, or if the expected value has the type `string`. The
agent has no example, and made no change. An example from the
reporter would help.

## Q46. An `env` key

`test.env` of vitest sets environment values for each test
process (`MODE=dev`). ubq has `define` (D83) and no `env`.
The reporter exported the values in the shell. D113 added a note
in `ubq convert`.

1. No key. The values go in the test script of `package.json`
   (not portable to Windows with no tool), or in a setup function
   with `env()`.
2. A key, `"env": { "MODE": "dev" }`: the runner gives the
   values to each test process, and `ubq convert` writes the key
   from `test.env`.

The agent would do 2. It is the same case as `define`: a value
that the old config gave to each test, with no good place in ubq.

## Q47. An alias for imports

`resolve.alias` and `test.alias` of vite map a name of an import
to a path. Test files that import such a name do not load. D92
said no transform and no resolver. D113 added a note in `ubq
convert`.

1. No key. Node has two forms that need no tool: the `imports`
   key of `package.json` (`#name`), and a package of the
   workspace.
2. A key, `"alias": { "@x/lib": "./modules/lib/src/index.ts" }`,
   in the resolve hook. Not the `paths` of a tsconfig: they have
   patterns, and a `baseUrl`.

The agent would do 1 for now. The alias of the report is made by
code in the vitest config, which a key with fixed names does not
replace.

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
