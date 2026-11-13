# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

The answers to Q1 to Q6 are D25 (step 3) and D26 to D31. The
answer to Q7 is D38. The answer to Q8 is D39. The answer to Q9 is
D45. The answer to Q10 is D48.

## Q11. Type errors in a run of a selection, and a second tsconfig (2026-11-13)

Blocked: two points of `13-agent-feedback-0.0.4.md`, item 6. Both
change what the type check of a run means (D38), so the user must
decide.

1. A run of one file prints the type errors of all files, and
   fails for them. In a conversion, the result of the selected
   file is lost. Options:
   - (a) No change: a type error anywhere fails each run.
   - (b) A run of a selection prints in full only the type errors
     in the selected test files. For the others it prints one
     line with the count and the command (`ubq types`), and they
     do not make the run fail. A run of all files does not
     change.
   - (c) As (b), but the other errors still make the run fail.
   The agent would do (b).
2. ubq checks only the `tsconfig.json` at the project root. A
   project with a second Worker has a second one
   (`analyst/tsconfig.json`), and ubq reports no error for its
   files. Options:
   - (a) Each `tsconfig.json` in a folder above a test file of
     the run, up to the root. No configuration.
   - (b) A `tsconfig` key in the ubq configuration: a list of
     paths.
   The agent would do (a).

