# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

The answers to Q1 to Q6 are D25 (step 3) and D26 to D31.

## Q7. Type checks next to tests: when, and with which exit code (2026-11-12)

Built, with the choices that the agent would make (`src/typecheck.ts`).
Nothing is blocked. A different answer changes two lines of
`src/runner.ts`.

**When does the type check run?**

- A. With each run of tests. Simple, but a type check of a large
  project takes seconds, and `ubq <file>:<line>` must stay fast
  (D11).
- B. With a run of all tests (`ubq` with no selection), and with
  `--types` for a smaller run. **Built.**
- C. Only with `--types`.

**What is the exit code of a run with type errors and no failed test?**

- A. 1, the same as a failed test. The summary starts with `fail`.
  **Built.**
- B. A code of its own, so that a script can tell the two apart.

The check runs only if the project has `tsconfig.json` in its root
and the `typescript` package. There is no option that turns it off
for a run of all tests (D2).
