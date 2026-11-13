# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

The answers to Q1 to Q6 are D25 (step 3) and D26 to D31. The
answer to Q7 is D38. The answer to Q8 is D39. The answer to Q9 is
D45.

## Q10. Tests in the Workers runtime (2026-11-13)

Blocked: tests of a Cloudflare Worker. A project that used
`@cloudflare/vitest-pool-workers` cannot convert (the report is in
`ubq-feedback.md`). The trial in `03-measurements.md`, section 14,
shows that workerd can load test files from the disk and run the
test API of ubq.

The plan of the agent:

- The runner stays on Node, Bun, or Deno. For a Workers test file
  it starts one workerd process (with `miniflare`), gives it the
  file, and reads the events. One process for each file, as now.
- The bindings come from the wrangler config of the project. ubq
  uses the `wrangler` package of the project (an optional peer
  dependency, as `playwright-core` is).
- Coverage for each test comes from source counters.
- `import { env } from 'cloudflare:workers'` gives the bindings.
  This is the API of the runtime, not of ubq.

Decisions that the user must make:

1. How does ubq know that a file is a Workers test? Options:
   - (a) A config key that pairs a wrangler config with globs:
     `"workers": [{ "config": "wrangler.jsonc", "include":
     ["test/**"] }]`. A project with two Workers has two entries.
   - (b) The text of the test file imports `cloudflare:` or
     `ubqtest/workers` (as `ubqtest/browser` does for the browser
     server). This fails for a test file that imports only source
     that imports `cloudflare:workers`.
   The agent would do (a).
2. The helpers that `cloudflare:test` has (`createExecutionContext`,
   `waitOnExecutionContext`, `createScheduledController`,
   `applyD1Migrations`). Options:
   - (a) A small module `ubqtest/workers` with new names, and
     `ubq convert` changes the imports.
   - (b) ubq also answers the name `cloudflare:test`, so the test
     files of the vitest plugin run with no change to these calls.
   The agent would do (a), with the fewest names possible.
3. Limits of a first version. In workerd these do not work without
   more design: `mockImport`, `testdir`, snapshot files,
   `fakeClock` for `node:timers`, and the hang report. A test with
   a time limit still fails, but without the list of open things.
   Is a first version with these limits acceptable?
4. The report asks for a `preload` config key, for a hook that
   makes Worker code load on Node. With a workerd runtime the
   reason goes away. The agent would not add the key.
