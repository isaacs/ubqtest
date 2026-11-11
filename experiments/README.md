# Experiments

Scripts that produced the numbers in `docs/03-measurements.md`. They
are measurement tools, not product code. Run `npm install` here first.

| Folder | Question | Run |
| --- | --- | --- |
| `coverage/` | What does a per-test coverage snapshot cost? Which V8 mode gives correct per-test data? | `node gen.mjs s10k 100 100 && node take.mjs s10k block 20 50`, `node hot.mjs block`, `node binary.mjs 1 1`, `node late.ts` |
| `start/` | What does a process, a worker, or a VM context cost to start? | `node warm.mjs` |
| `suite/` | How fast are other frameworks on the same suite? | `node gen.mjs 200 10`, then the commands in `docs/03-measurements.md` |
| `proto/` | How fast is the planned design in each isolation mode? | `node proto/runner.mjs process suite/t-proto` (from `suite/`: `node ../proto/runner.mjs process t-proto`) |
| `transport/` | Which child-to-runner transport is fastest? | `node parent.mjs 2000 16` |
| `sqlite/` | What does the run database cost? | `node write.mjs` |
| `runtimes/` | Which building blocks exist on Node, Deno, and Bun? | `node caps.mjs`, `node cov-async.mjs`, `node fd3-parent.mjs` |
| `hang/` | What does async tracking cost? Can the runner read the stack of a wedged child? | `node cost.mjs hook`, `node report.mjs`, `node sigusr1.mjs` |
| `api/` | Do the types and the mock call in `docs/05-api.md` work? | `npx tsc -p api` (errors only in `bad.ts`), `node api/mock-rt.ts` |
| `bun/` | How can Bun record per-test coverage? | `BUN_JSC_useControlFlowProfiler=1 bun jsc.ts`, `bun plugin.ts`, `bun static.ts` |
| `hooks/` | Do typed, scoped module mocks work with no flags? | `node use.ts` |

`hang/wd.mjs` and `hang/watchdog.mjs` record two methods that did not
work. Both wait with no time limit, so run them under `timeout 10`.
