# Docs Index

Read this file first. Open only the documents that the task needs.

| File | Contents | Read it when |
| --- | --- | --- |
| `00-initial-prompt.md` | Project goals and constraints, from the user. | You need the reason for a design goal. |
| `01-agent-ideation.md` | What agents need from a test tool: 12 problem areas, a priority list, risks, open questions. | You design a feature, an output format, or a CLI command. |
| `02-decisions.md` | Decision records D1 to D140: coverage, strict rules, weaker-model guardrails, wire format, transport, isolation, Bun, speed goal, name (`ubq`), API shape, `testdir`. | Before you design or change anything. A decision there overrides an idea in `01`. |
| `03-measurements.md` | Measured costs: coverage, process start, other frameworks, prototype, transport, SQLite, hangs, runtime support, Bun coverage options. | You need a number, or you doubt a design choice. |
| `04-architecture.md` | The architecture plan: parts, process model, events, coverage, store, selection, hangs, speed budget, build order, open questions. | You start any implementation work. |
| `05-api.md` | The test file API (accepted): `test`, `describe`, `assert`, mocks, spies, fixtures, and what is absent on purpose. | You write a test, or you implement the core library. |
| `06-events.md` | The event model and rules. Exact fields are in `src/events.ts`. | You write or read events: a sink, the runner, the store. |
| `07-status.md` | Commands, checks, lessons, a short log of what is built, and what waits for a decision. | First, in each new session. |
| `08-config.md` | Which files ubq runs by default, and the `ubq` key of `package.json`. | You change test file selection, or you add a setting. |
| `10-bun-coverage-api.md` | What ubq needs from Bun for per-test coverage, what Bun 1.4.3 has, and the change to Bun that closes the gap. | You work on coverage on Bun, or on the proposal to the Bun project. |
| `11-server.md` | The background server: what it does, the rule of equal results, the protocol, measurements, why no MCP and no HTTP. | You change the server, or the way the runner starts a test process. |
| `12-agent-feedback-0.0.3.md` | The report of an agent that tried to convert a Cloudflare Workers project to ubq 0.0.3, and went back to vitest. | You work on Workers tests or on `ubq convert`, or you want the reason for D48. |
| `13-agent-feedback-0.0.4.md` | The second report of the same agent, on ubq 0.0.4: one of two Workers converted, and what stopped the other. | You work on Workers tests or on `ubq convert`. |
| `14-agent-feedback-0.0.5.md` | The third report, on ubq 0.0.5: the conversion is complete, with a list of the hand work that a less able model can get wrong. | You work on `ubq convert` or `ubq doctor`. |
| `15-agent-feedback-0.0.6.md` | The fourth report, on ubq 0.0.6: a smooth conversion, with polish for `ubq doctor`, the report of `ubq convert`, and the guide. | You work on `ubq convert` or `ubq doctor`. |
| `16-agent-feedback-0.0.14.md` | A report on ubq 0.0.14: a vitest Workers project with 225 tests, converted. It led to `assert.contains` (D77), `ubq --update` with no test (D76), and fixes to the layout of `ubq convert`. | You work on `ubq convert`, `ubq doctor`, or assertions. |
| `17-agent-feedback-0.0.15.md` | A report on ubq 0.0.15: two vitest Workers projects with 225 tests, converted. It led to the removal of the restore form of a helper by `ubq convert`, wrapped TODO comments, more notes in the report of `convert`, a hint for a type error in an expected value, and a diff of the `ubq` key in `ubq check`. | You work on `ubq convert`, `ubq check`, or type errors. |
| `18-agent-feedback-0.0.16.md` | A report on ubq 0.0.16: a small TypeScript library, built with tshy, converted from tap. It led to a fix of the parser for `assert` after an `import`, doctor checks for files that do not import ubqtest and for a tsconfig that emits, and more TODOs and notes from `ubq convert`. | You work on `ubq convert`, `ubq doctor`, or the parser. |
| `19-sonnet-feedback-0.0.16.md` | A report on ubq 0.0.16 from a smaller model: 167 vitest files of a large project (sentry-javascript `packages/core`), converted by eight agents. It led to imports with no extension (D78), the doctor check for syntax that Node cannot run (D79), and fixes to `ubq convert` for `rejects`, spies of a module namespace, checks of many calls, and optional chains. | You work on `ubq convert`, `ubq doctor`, module resolution, or the types of `assert` and `spy`. |
| `20-seldo-feedback-0.0.18.md` | A report on ubq 0.0.18: 45 vitest files of a simulation game, with numeric assertions, converted. It led to D98 to D101: `assert.equal` with no narrowing, `assert.greaterThan`, `assert.lessThan`, `assert.close`, and Node 22.18. | You want the evidence for those decisions. |
| `21-whosonfirst.ai-feedback-0.0.19.md` | A report on ubq 0.0.20: 36 `node:test` files of a static site converted, with tests in a browser that the project starts itself, and tests in the Workers runtime. It led to D116: the converter keeps the message of an assertion, `prepareContext`, the output of a file that calls `process.exit`, and an error for an option that ubq does not have. | You work on `ubq convert` for `node:test`, on browser tests with a project's own Playwright, or on the reports of a run. |
| `22-glob-fable-feedback-0.0.19.md` | A report on ubq 0.0.19: the 42 tap test files of `glob` converted by an agent, from the prompt of the site. It led to D119: tap forms that the converter dropped with no word, a mock that replaced no import, and type errors of a different project. | You work on `ubq convert` for tap, on `mockImport`, or on the type check. |
| `23-sentry-core-feedback-0.0.22.md` | A report on ubq 0.0.22: the 171 vitest files of sentry-javascript `packages/core` converted by one agent with eight sub-agents, with what the strict rules found, and what to expect in the rest of the monorepo. It led to D123 and D124 (`assert.matchOnly`, `this` of a spy call, the command in a failed summary): `args` of a spy call as `unknown[]`, `isMatch`, the place of the first difference of an `isDeepEqual` call, and fixes to `ubq convert` for `setup()` with no `;`, optional chains, matchers of `expect` in a spy check, and the order of hooks. | You work on `ubq convert` for vitest, on spies, or on `assert.match`, or you plan the conversion of a monorepo. |
| `24-minimatch-feedback-0.0.24.md` | A report on ubq 0.0.24: the 38 tap test files of minimatch converted, with a retest on 0.0.26. It led to D129 to D131: the message of an assertion in a snapshot key, `"coverage": "full"`, a run of only skips that passes, the ubq version in a run, and fixes to `ubq convert` for tap. | You work on `ubq convert` for tap, on snapshots, or on coverage. |
| `25-hermetic-feedback-0.0.23.md` | A report on ubq 0.0.23: an npm workspace with 491 vitest tests, where the conversion did not pass. It led to D132: function text with no counters, `NODE_OPTIONS` in the `env` key, the pass line, and fixes to `ubq convert` for names, imports, and setup files. | You work on coverage counters, on `ubq convert` for vitest, or on the environment of a test process. |
| `store.md` | The tables and columns of the store (`.ubq/runs.db`), with example queries for `ubq sql`. | You write a query for `ubq sql`, or you change the tables in `src/store.ts`. |
| `api.md` | Each export of the package with its type and doc comment. Made by `npm run docs` from the type declarations. | You need the exact type of an export. Do not change it by hand. |
| `09-questions.md` | Points that wait for a decision from the user, with options. | You look for work that is not blocked, or the user is present. |

Measurement scripts are in `experiments/` (see its `README.md`).
Agent evals, with ubq, vitest, and `node:test`, are in `evals/` (see
its `README.md`).

## Rules for this folder

- Number the files in the order of their creation.
- Add one row to the table for each new file.
- Keep each row to one line.
