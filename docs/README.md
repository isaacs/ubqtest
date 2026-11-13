# Docs Index

Read this file first. Open only the documents that the task needs.

| File | Contents | Read it when |
| --- | --- | --- |
| `00-initial-prompt.md` | Project goals and constraints, from the user. | You need the reason for a design goal. |
| `01-agent-ideation.md` | What agents need from a test tool: 12 problem areas, a priority list, risks, open questions. | You design a feature, an output format, or a CLI command. |
| `02-decisions.md` | Decision records D1 to D47: coverage, strict rules, weaker-model guardrails, wire format, transport, isolation, Bun, speed goal, name (`ubq`), API shape, `testdir`. | Before you design or change anything. A decision there overrides an idea in `01`. |
| `03-measurements.md` | Measured costs: coverage, process start, other frameworks, prototype, transport, SQLite, hangs, runtime support, Bun coverage options. | You need a number, or you doubt a design choice. |
| `04-architecture.md` | The architecture plan: parts, process model, events, coverage, store, selection, hangs, speed budget, build order, open questions. | You start any implementation work. |
| `05-api.md` | The test file API (accepted): `test`, `describe`, `assert`, mocks, spies, fixtures, and what is absent on purpose. | You write a test, or you implement the core library. |
| `06-events.md` | The event model and rules. Exact fields are in `src/events.ts`. | You write or read events: a sink, the runner, the store. |
| `07-status.md` | What is built, by step. Commands, source file map, known limits. | First, in each new session. |
| `08-config.md` | Which files ubq runs by default, and the `ubq` key of `package.json`. | You change test file selection, or you add a setting. |
| `10-bun-coverage-api.md` | What ubq needs from Bun for per-test coverage, what Bun 1.4.3 has, and the change to Bun that closes the gap. | You work on coverage on Bun, or on the proposal to the Bun project. |
| `11-server.md` | The background server: what it does, the rule of equal results, the protocol, measurements, why no MCP and no HTTP. | You change the server, or the way the runner starts a test process. |
| `12-agent-feedback-0.0.3.md` | The report of an agent that tried to convert a Cloudflare Workers project to ubq 0.0.3, and went back to vitest. | You work on Workers tests or on `ubq convert`, or you want the reason for D48. |
| `13-agent-feedback-0.0.4.md` | The second report of the same agent, on ubq 0.0.4: one of two Workers converted, and what stopped the other. | You work on Workers tests or on `ubq convert`. |
| `api.md` | Each export of the package with its type and doc comment. Made by `npm run docs` from the type declarations. | You need the exact type of an export. Do not change it by hand. |
| `09-questions.md` | Points that wait for a decision from the user, with options. | You look for work that is not blocked, or the user is present. |

Measurement scripts are in `experiments/` (see its `README.md`).

## Rules for this folder

- Number the files in the order of their creation.
- Add one row to the table for each new file.
- Keep each row to one line.
