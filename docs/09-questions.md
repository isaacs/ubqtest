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
is D66. The answer to Q22 is D80. The answer to Q24 is D82. The answer to Q25 is D81.

Q14 to Q20 come from the wants in `01-agent-ideation.md` that the
code does not have yet. The section of that file is in brackets.

## Q17. One command for each runtime (11)

`01` asks for a matrix run that reports which runtime failed.
Today a person runs `ubq` on each runtime, and `ubq merge` joins
the coverage.

Options:

1. No command. CI makes the matrix.
2. `ubq --runtimes node,bun,deno` runs each file on each runtime
   that is installed, and the summary names the runtime of each
   failure.

The agent would pick 2 only if users ask for it. Its cost is
three times the run.

Q21 to Q26 come from `19-sonnet-feedback-0.0.16.md`: a conversion
of 167 vitest files of sentry-javascript `packages/core` by eight
agents on a smaller model. "N of 8" is the count of agents that
hit the problem.

## Q21. Values that a build tool puts in the source (8 of 8)

The vite config of the project has `define: { __DEBUG_BUILD__:
true }`. Vite puts the value in place of the name. With ubq, the
source throws `ReferenceError: __DEBUG_BUILD__ is not defined`
when it loads. Each agent set the value in its own way:
`globalThis.__DEBUG_BUILD__ = true` in a loader of `NODE_OPTIONS`
(6 agents), a Bun `--preload` (1), or `BUN_OPTIONS="--define
__DEBUG_BUILD__=true"` (1). A different vite plugin of the
project removes blocks of the source (5 of 8 noticed it, 1
needed it).

Options:

1. No config. `ubq convert` reads `define` of the vite config and
   prints a note with a recipe: a module that sets each value on
   `globalThis`, which each test file imports first.
2. A `define` key in the `ubq` key of `package.json`: names and
   JSON values. The preload sets each one on `globalThis` before
   the test file loads. `ubq convert` writes the key from the
   vite config, as it writes `workers`.
3. A `preload` key: a list of modules that the runner loads before
   each test file. More general, and it also covers other setup,
   but it is a second place for the setup of a test, and the setup
   is then not in the test file (`05-api.md`, section 2).
4. As 2, and the hook also puts the value in place of the name in
   the source, as vite does. A global is not the same: `typeof
   __DEBUG_BUILD__` and dead code differ. This costs a parse of
   each project file.

The agent would pick 2. It is one way, it needs no code in the
project, and the converter can write it. A transform of the
source, as in 4 and in the vite plugin, is out of scope.

## Q23. "Any value of a type" in a pattern (8 of 8)

vitest has `expect.any(Number)`, `expect.anything()`, and
`expect.stringMatching` at any depth of an expected value. ubq
has `assert.match` with a RegExp for a string, and nothing for "a
number" or "a function". The corpus has 270 `expect.any` and 46
`expect.anything`. Each agent wrote a helper of 30 to 45 lines,
each different, and some copied it into two files.

Options:

1. No change. The guide shows two assertions: `assert.match` for
   the keys with known values, and `assert.equal(typeof x.n,
   'number')` for the others.
2. A function in a pattern of `assert.match` is a predicate: `{
   id: (v: unknown) => typeof v === 'number' }`. A failure shows
   the key, the value, and the text of the function. One rule, no
   new names.
3. Exports for the common cases: `assert.match(x, { id: any(Number)
   })`, `anything()`. Closer to vitest, so the converter can change
   them with no TODO. More names, and a second way next to 2.

The agent would pick 2. The converter can then change
`expect.any(Number)` in a pattern to `(v: unknown) => typeof v ===
'number'`. Note: today a function in a pattern compares by
identity, so 2 changes a rule. A pattern that has a real function
as an expected value would need `assert.equal` for it.

## Q26. Two changes of `ubq convert` that are not always certain (7 of 8, 8 of 8)

- **`it.each` and `describe.each`.** The agents wrote about 200
  loops by hand or with scripts. A table of arrays
  (`it.each([[1, 2], [3, 4]])('%s', (a, b) => ...)`) can become
  `for (const [a, b] of [[1, 2], [3, 4]]) test(...)`. The name is
  hard: `%s`, `%j`, `$name`, and `%#` need a template literal, and
  two rows can give one name (`ubq` fails on a duplicate name).
- **Hooks.** The agents added about 500 `setup()` calls by hand. A
  `beforeEach` whose body only assigns to `let` variables of its
  `describe` could become a `setup` function, with a call at the
  start of each test of the group, and the variables stay where
  they are. A test that forgets the call runs with old state, with
  no error.

Options for each:

1. Keep the TODO.
2. Change the simple forms (a table of literals with `%s`, `%d`,
   `%i`, `$name`, or a `beforeEach` with only assignments), add
   the index to a name when two rows give one name, and keep the
   TODO for each other form.

The agent would pick 2 for `each`: the change is certain for the
simple forms, and the converted names can be checked. For hooks,
the agent would pick 1. The change is certain only for few forms,
and a group of tests that share state is a design that the agent
should look at.
