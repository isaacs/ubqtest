# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

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
are D117. The answers to Q51 and Q52 are D121.

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

Q53 to Q58 come from `23-sentry-core-feedback-0.0.22.md`. D123 has
what is done for the rest of that report.

## Q53. An exact comparison with one value that changes

**Blocked:** about 350 TODO comments of the report were a matcher
of `expect` in an exact comparison, such as `toEqual({ id: 1,
time: expect.any(Number) })`. `assert.match` is partial at each
depth, so it is weaker. To stay exact, the agents copied the
actual value into the expected value: 29 times in one file, 12 in
a second one. D85 decided that `assert.deepEqual` does not change.

**Options:**

1. No change. The convert guide has the form: assert on the value
   that changes, then `assert.deepEqual(event, { id: 1, time:
   event.time })`.
2. A function in the expected value of `assert.deepEqual` is a
   predicate, by the rules of D85. A function that is the same
   function as the actual value matches, as in a pattern. A test
   that compares two different functions with `deepEqual` then
   calls one with the other.
3. A new assertion that is exact, with predicates (a name such as
   `assert.exact`). It is a second way to state `deepEqual`.

**The agent would do:** option 1 now. It is one more line for each
value. Option 2 is the smallest change that removes the hand
work, and the type rule of D85 (a function in a pattern must be
`(value: unknown) => boolean`) can keep most wrong calls out. I
would do option 2 if a second report has the same count.

## Q54. `ubq failures` with no run number, with many runs in one store

**Blocked:** eight agents worked in one project at the same time.
`ubq failures` with no number shows the newest run of the store,
which was often the run of a different agent. All eight agents
hit this. The summary line of a run has the run number, and the
agents did not read it first.

**Options:**

1. No change. The convert guide now says to use the run number.
2. The last line of each run with a failure names the command:
   `ubq failures 812`. A run with more than 20 failures has this
   line now. It is one more line for each failed run.
3. `ubq failures` with no number shows the newest run that the
   same parent process started. A shell of an agent is often a
   new process for each command, so this is not certain.

**The agent would do:** option 2. The agent copies the command
that it sees. Option 3 has a result that the reader cannot
predict.

## Q55. A spy records `this`

**Blocked:** `mock.instances` and `mock.contexts` of vitest have no
form. Two files of the report needed a hand-written
implementation that keeps `this`, and one has a lint warning for
it. `ubq convert` writes a TODO with that form.

**Options:**

1. No change.
2. Each call of a spy has `this`: `{ args, result, error, this
   }`. `assert.equal(s.calls[0]?.this, emitter)`.

**The agent would do:** option 2. It is one property, the spy has
the value at hand, and it adds no second way.

## Q56. A tick of the fake clock that is not async

**Blocked:** `clock.tick(ms)` returns a promise (D30). A test that
moves the clock in a callback that is not async must make the
callback async, which changes the code under test. The report
has one such test of about 200 uses of `tick`. Each test with a
timer is `async`.

**Options:**

1. No change.
2. `clock.tickSync(ms)`: runs the timers that are due, and no
   promise callback between them. It is a second way to move the
   clock, and code with promises between two timers then gets a
   different order from the real one.

**The agent would do:** option 1. One case of 200 does not pay
for a second form with a different order.

## Q57. Source that a plugin of the build changes for the tests

**Blocked:** the shared vite config of the sentry monorepo has a
plugin that removes each `/*! rollup-include-cjs-only */` block
before vitest runs the source. Eight source files of other
packages have such a block. ubq has no plugins (D92), and the
`transform` key is only a compiler of TypeScript (D111). The
tests of those packages will run the CommonJS code. `ubq convert`
printed no note: the plugin is in a config that the config of the
package imports.

**Options:**

1. No change. The owner changes the source: a condition at run
   time in place of the comment block.
2. `ubq convert` follows the imports of a vite config, and prints
   its note about plugins for a plugin of a shared config too.
3. A key for a transform of the project (a module with a function
   from source text to source text). This is the plugin interface
   that D92 left out.

**The agent would do:** option 2, with option 1 as the advice of
the note. The person then knows before the tests run different
code. Not option 3: it changes what the tests run, with no trace
in the test file.

## Q58. Class fields with no value, and the target of the build

**Blocked:** Node removes the types and keeps a field declaration
(`class A { x?: number }`), so the field exists with the value
`undefined` after `new A()`. A project that builds with a target
below ES2022, or with `useDefineForClassFields: false`, ships
code where the field does not exist until code assigns it. `'x'
in a`, `Object.keys(a)`, `hasOwnProperty`, and a field of a
subclass that hides a value of the base class then differ between
the tests and the shipped code. One test of the report failed for
this reason. The `stub` type for a value of `undefined`
(`stub(globalThis, 'performance', undefined)` needs a cast) is a
small point of the same report: tell me if `stub` must take
`undefined` for each key.

**Options:**

1. No change.
2. `ubq doctor` has a `note` line for a tsconfig with such a
   target or option: the text names the difference, and the
   `transform` key, which compiles with the options of the
   tsconfig.
3. A `FIX` line in place of the note.

**The agent would do:** option 2. The difference is real, and
few projects have a test that sees it.
