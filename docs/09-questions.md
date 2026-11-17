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
is D66. The answer to Q21 is D83. The answer to Q22 is D80. The answer to Q24 is D82. The answer to Q25 is D81. The answer to Q26 is D84.

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
4. `assert.typeof(value, 'string')`, which also narrows the type.
   It checks one value. Only 9 of the 270 `expect.any` are the
   whole expected value. The other 261 are a placeholder in an
   object, an array, or the arguments of a call, such as
   `toHaveBeenCalledWith({ id: expect.any(Number), name: 'x' })`.
   With only 4, each of those becomes several assertions. And 50
   of the 270 are classes (`URL`, `Error`), which `typeof` cannot
   check. 4 can come in addition to 2 or 3, for one value at the
   top level.

The user asked about 4 (2026-11-17), and then saw the case of a
placeholder in a deep pattern. Not decided.

The agent would pick 2. The converter can then change
`expect.any(Number)` in a pattern to `(v: unknown) => typeof v ===
'number'`. Note: today a function in a pattern compares by
identity, so 2 changes a rule. A pattern that has a real function
as an expected value would need `assert.equal` for it.
