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
is D66. The answer to Q21 is D83. The answer to Q22 is D80. The answer to Q24 is D82. The answer to Q25 is D81. The answer to Q26 is D84. The answer to Q23 is D85. The answer to Q17 is D86.

Q14 to Q20 come from the wants in `01-agent-ideation.md` that the
code does not have yet. The section of that file is in brackets.

Q21 to Q26 come from `19-sonnet-feedback-0.0.16.md`: a conversion
of 167 vitest files of sentry-javascript `packages/core` by eight
agents on a smaller model. "N of 8" is the count of agents that
hit the problem.

Q27 to Q35 come from the same report. They are the points that
D78 to D86 did not decide.

## Q27. A spy that changes after it is made (6 of 8)

vitest has `mockClear`, `mockReset`, `mockReturnValue` on a spy
that exists, and `mockImplementationOnce`. A ubq spy gets its
implementation when it is made, and has only `calls`. The agents
wrote `spy.calls.length = 0`, a flag in the implementation, or a
variable that the implementation reads. The case that is hard is a
spy from a shared helper, or a spy at the top level of a file,
which lives until the file ends.

Options:

1. No change. The guide says: make the spy in the test or in a
   setup function, and let the implementation read a variable.
   `spy.calls.length = 0` clears the calls.
2. `spy.use(impl)` replaces the implementation. With a closure it
   does the work of "once" and of "return value".
3. Also `spy.reset()`, and a form for one call.

The agent would pick 1, and add the three recipes to the hint and
the guide. 2 and 3 make a spy that changes in a test, which is the
design that ubq left out.

## Q28. A mock that keeps the other exports (7 of 8)

`mockImport` needs each export that the code under test imports.
The agents wrote `{ ...real, fn: spy() }` with an import of the
real module. The hint now shows this form.

Options:

1. No change. The spread is one line, and it shows that the other
   exports are real.
2. `mockImport` keeps each export that the mock does not name.
   A mock can then not remove an export.
3. An option: `{ partial: true }`.

The agent would pick 1. The need was the text of the hint, and
that is done. 2 hides which code is real.

## Q29. The expected error of `throws` and `rejects` (4 of 8)

- `toThrow(error)` with an Error instance is common. In ubq it is
  a type error. The agents wrote `{ message: error.message }`.
- `assert.rejects` takes a `Promise`, not a `PromiseLike` (2 of
  8).
- A rejection that is not an Error, such as a Symbol, has no form
  (1 of 8).

Options for the instance:

1. No change. The converter writes `{ message: error.message }`
   for a name, with a TODO if it cannot know that the value is an
   Error.
2. An Error instance as `expected` compares the class and the
   message.

The agent would pick 1 for the instance: 2 is a fourth meaning
for one parameter. The agent would accept a `PromiseLike` (it is
a wider type and no new rule). For a value that is not an Error,
the agent would make no form: `assert.rejects` already returns
the value, so `assert.equal(await assert.rejects(p, ...), value)`
needs only a pattern that matches any value. That part needs your
answer: is `(v: unknown) => true` as `expected` good enough, or
is a rejection with a value that is not an Error a failure in
ubq?

## Q30. `ubq convert` writes the `setup()` calls for hooks (8 of 8)

D84 keeps the TODO for hooks. The agents then wrote about 500
`setup()` calls by hand, and some wrote scripts for it. The case
that is certain: a `beforeEach` at the top level of the file or
of a `describe`, whose body assigns no outer variable.

Options:

1. No change (D84).
2. For the certain case, the command makes `const setup = () =>
   {...}` and puts `setup()` (or `await setup()`, and makes the
   test `async`) as the first line of each test in that scope. An
   `afterEach` with the same limits becomes `cleanup(...)` in that
   function. Each other hook keeps the TODO.

The agent would pick 2. Most hooks in the corpus assign outer
variables (`let client; beforeEach(() => { client = ... })`), so
the agent must measure how many hooks 2 changes before it is
worth the code.

## Q31. An assertion for "some call had these arguments"

`toHaveBeenCalledWith` passes if any call matches. The converter
writes `assert(spy.calls.some(call => isDeepEqual(call.args,
[...])))`. A failure of that line shows `false`, and not the
calls.

Options:

1. No change.
2. `assert.contains` on `spy.calls.map(c => c.args)` with deep
   equality. This changes `contains`, which uses `includes` now.
3. `assert.calledWith(spy, ...args)`. A failure shows each call.

The agent would pick 1 for the API, and make the failure better:
the report can show the value of `spy.calls` when an `assert(...)`
on it fails. If that is not possible, 3.

## Q32. Source that a vite plugin changes (5 of 8)

Sentry has a plugin that removes blocks of the source between two
comments. ubq runs the source as it is. One of eight agents
needed the plugin, and wrote a loader. `ubq convert` now prints a
note for a config with plugins.

Options:

1. No change. ubq tests the code that is in the repository. A
   project that needs a transform tests its build.
2. A `"transform"` key: a module that gets the text of each
   source file. Coverage and stack places then need a source map
   from it.

The agent would pick 1.

## Q33. Tests that need a DOM (2 of 8)

Files with `@vitest-environment jsdom` fail with `document is not
defined`. ubq has browser tests (`ubq --browser`), which run in a
real browser. The agents made a jsdom window by hand and put its
globals on `globalThis` with `cleanup`.

Options:

1. No change. The TODO says to tell the user.
2. A recipe in the convert guide: jsdom by hand, with `stub` for
   each global.
3. A helper: `dom()` of `ubqtest/dom` makes the window of jsdom
   (a package that the project installs) and stubs the globals
   until the test ends.
4. The guide says to move such a file to the browser tests.

The agent would pick 2: the code is short with `stub`, and it
adds no API. 4 is correct for tests of real DOM behavior, and too
much for a test that needs only `document.createElement`.

## Q34. The tsconfig of the tests (6 of 8)

`ubq doctor` and the type check read `tsconfig.json`. Sentry has
the test files and their options in `tsconfig.test.json`, and
`tsconfig.json` includes only `src`. Doctor then asks for options
that the project has, in a file that must not have them.

Options:

1. No change. The project adds a `tsconfig.json` in the test
   folder (the type check uses each `tsconfig.json` in the
   folders from a test file up to the root).
2. A `"tsconfig"` key with the path of the file.
3. ubq uses `tsconfig.test.json` if it is there.

The agent would pick 1 and make doctor say it: if no
`tsconfig.json` includes the test files, the FIX line
tells the agent to add `test/tsconfig.json` that extends the
other file. No new key.

## Q35. The format of converted code (6 of 8)

`ubq convert` keeps the code correct, not its format. It prints
the command of the formatter of the project in a note. Six agents
ran the formatter by hand, and one did not see the note.

Options:

1. No change.
2. The command runs the formatter of the project on the files
   that it changed, and says so. `--no-format` stops it.
3. The note becomes the last line of the output.

The agent would pick 2 without the option: one way. The formatter
is already a dependency of the project, and the agent runs it in
each case.
