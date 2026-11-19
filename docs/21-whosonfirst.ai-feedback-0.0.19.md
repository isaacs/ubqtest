# ubq feedback

For the author of [ubq](https://ubq.dev). Notes from converting the tests of two repositories from `node:test` and `node:assert` to `ubqtest` 0.0.20, on 2026-11-19:

- **whosonfirst.ai**, this repository: a static Astro site. 36 test files: unit tests of its data, tests that read the built site as files, tests that open it in Chromium with the project’s own Playwright, and tests that serve it in the Workers runtime through `astro preview`.
- **whosonfirst-studio**, a private repository that works beside this one. Two small test files for a script that syncs files with an R2 bucket. Its findings are in their own section below, and its code is not public.

Node 22.23.5, TypeScript 6.0.3, Playwright 1.63.0, Biome, on a Linux container with 4 CPUs.

## How the work was done

A coding agent, Claude Code, did the work in two passes:

1. **Opus 5.5 at low effort.** It ran `ubq doctor` and `ubq convert test`, rewrote the shared browser helper, and gave the 254 `TODO(ubq)` comments to three sub-agents working side by side, one for each group of test folders. It checked the result by running the suites.
2. **Opus 5.5 at medium effort**, as a second pass over the first. It read the diff and did not rely on the sub-agents’ reports. It repeated each claim below that it could, on this code or in a small test project. It also corrected some things the first pass had got wrong, including three points in an earlier version of this file.

Below, “confirmed” means the second pass saw it happen. “Reported” means a sub-agent saw it, and it was not repeated.

## Counts

| Suite                                | `node:test`        | ubq                | Why they differ                         |
| ------------------------------------ | ------------------ | ------------------ | --------------------------------------- |
| `test/unit/`                         | 210 pass           | 247 pass           | Loops made into one test per case (+37) |
| `test/build/`, `test/worker/`        | 47 pass            | 133 pass           | Loops made into one test per page (+86) |
| `test/browser/`                      | 1077 pass, 12 skip | 1079 pass, 12 skip | One loop made into a test per case (+2) |
| whosonfirst-studio `test/` (private) | 7 pass             | 7 pass             |                                         |

No test was removed or skipped, and no assertion was made weaker. Where the count of assertion calls in a file went down (3 of 36 files), the calls were folded into one `assert.deepEqual(bad, [])` over a list, or were an `assert.doesNotThrow` that is now a plain call. The 12 skips are the same tests, skipped by the same rule.

The higher counts were the agent’s choice, not something ubq requires: the site already makes one test per case in loops, which is where most of its 1000-odd rendered tests come from.

Time, measured once each, back to back on the same machine:

| Suite                                | `node --test` | `ubq` |
| ------------------------------------ | ------------- | ----- |
| `test/unit/`                         | 2.2 s         | 2.4 s |
| `test/build/`, `browser/`, `worker/` | 74 s          | 85 s  |

The ubq time includes its type check and coverage. The Node run let six browser files run their suites side by side within the file, which ubq does not.

## What went well

- **`ubq convert` is accurate.** It changed 37 files and left code that ran, and it ran Biome on them. Each TODO was at the place where the work by hand was.
- **`ubq doctor` had nothing to fix,** and `.test.mjs` files needed no configuration.
- **The type check found a real defect** that the project’s own check hid. TypeScript 6 refuses `baseUrl` (TS5101). `astro check` passes, but plain `tsc` fails, and so did `ubq`. The fix was to drop `baseUrl` and write the path alias as `./src/*`. (The first pass took this for a fault of ubq.)
- **Failure blocks are short and useful,** and `rerun: ubq file:line` works. A line inside a loop selects that test for each value of the loop, which is the right thing.
- **The lazy setup from `ubq guide convert`,** `const setup = () => (ready ??= work())` with a top-level `cleanup()`, worked for a static server, a browser and a spawned `astro preview`. 13 tests from the middle of their groups each passed when run alone.
- **“The test ran no assertions”** turned one browser test’s only check, a `waitForFunction` that failed only by timing out, into an assertion that shows the scroll position.
- **The default limit of 5000 ms** was enough for all but two tests, which read every page. Those now set `{ timeout: 20_000 }`.
- **`ubq check`** ends the work with one clear line.

## What improved in the tests

- **One test per case** names the page, header or comparison that failed. Before, a run stopped at the first failing case and named it only in a message.
- **`assert.deepEqual(bad, [])`** shows every offender at once.
- **`assert.match(result, { status: 0 })`** shows a child process’s whole result, its output too.
- **Tests that relied on what an earlier test left** now set up that state themselves.
- **The worker helper** now waits for the child’s `close` event, as the guide says, where it waited for `exit`.

## Problems, most costly first

1. **The docs disagree about assertion messages.** Confirmed. This had the largest cost.
   - The API reference says “Each assertion takes a `message` as its last argument”, and the types agree (`assert.equal<T>(actual, expected, message?)`). At run time, ``assert.equal(x, 1, `case ${x}`)``fails with`case 2: expected values to be equal`.
   - The guide’s API list shows a message only on `assert(value, message?)`.
   - `ubq guide convert` says “ubq assertions have no message”, and `ubq convert` acts on that. It moves a text message into a comment. For a message made by an expression, it writes a three-line TODO. That was 150 of the 254 TODOs here, often one above each assertion in a loop (18 in one file).
   - If messages are meant to stay, the converter could keep them, and leave a TODO only where splitting into a test per case is the better change.

2. **A browser that is not `ubqtest/browser` breaks on coverage counters.**
   - The counters are written into test and helper code, so a function passed to `page.evaluate` takes them into the page. This site’s helper launches Playwright itself, because it serves the built site with the site’s own response headers. Under ubq, 197 of 281 browser tests failed with `page.evaluate: ReferenceError: __ubqc is not defined` (the count was reported by a sub-agent).
   - The fix is the stub that ubq’s own `browser()` installs, `globalThis.__ubqc = new Proxy({}, { get: () => 0, set: () => true })`, as an init script on each context. Confirmed: that string is in `browser.js`. The name is not exported, and none of `GUIDE.md`, `CONVERT.md` or `README.md` mentions it.
   - Exporting the stub, or a function that prepares a Playwright context, would let a project keep its own launch.

3. **A file that exits does not say why.** Confirmed.
   - A test file that writes `console.error("The built site is older than its sources: rebuild.")` and then calls `process.exit(1)` gives only `ERROR test/b.test.mjs` / `process.exit(1) was called before the tests ended`. The file’s own message is not shown.
   - This site’s tests stop like that on a stale build, and the first pass spent time on it twice.

4. **Type errors in a selected run cannot be found.** Confirmed.
   - `ubq test/unit/rating.test.mjs` ended `pass: 0 failed, 10 passed, 1 type errors in other files (run 65)`. `ubq failures 65` printed only the summary, and run 65 has no row in `type_error`. Only a full `ubq` names the error.
   - A line such as `run ubq to see them` would help. So would “1 type error”, not “1 type errors”.

5. **The converter does half of a hook.** Confirmed on a copy of the original files.
   - It removes `before` and `after` from the import, and leaves an `after(...)` call that now names nothing.
   - It makes a top-level `before(async () => { site = await startWorker() })` into a block at the top of the file. That starts the server when the file loads, not when a test needs it. Moving it is easy, but the change of time is easy to miss.
   - Writing the `ready ??=` setup, or a TODO that says “make it lazy”, would be safer.

6. **`ubq review` says “nothing to do” after a conversion.** Confirmed: `ubq review --diff=main` printed `review: nothing to do` with 36 test files changed. The conversion guide does say that review compares only ubq tests, and `main` has none. But the output should say that nothing was compared, not that nothing changed. (The first pass reported this as review “seeing little” of uncommitted work. That was the wrong reading.)

7. **A failure found at the end of the file is not a test’s failure.** Confirmed.
   - `assert` in a top-level `cleanup()` is refused: `a cleanup function failed: Error: assert was called outside a test`. So this site’s helper throws an `Error` instead.
   - When a page threw a script error, the run reported `fail: 1 errors, 0 failed, 1 passed`, with the test that opened the page among the passed.
   - A file-level check that can fail as itself, or that is named for the last test, would read better.

8. **There is no skip decided while a test runs.**
   - The site skips a line-length test on a page with no paragraph of three lines, which it learns only by measuring.
   - Under ubq, a top-level `await` opens every page in each theme and window size first (56 page loads), so that `{ skip: cond && 'reason' }` can be decided when the test is made.

9. **The tests of a file run one at a time.**
   - Six browser files ran their suites side by side with `{ concurrency }` options. They now run in order, which is likely part of the difference in time above. That was not measured on its own.
   - Unknown options are accepted without a word: `describe('g', { concurrency: 4 }, fn)` runs. Confirmed.

10. **No hooks means repeated lines.**
    - A group of 7 tests that share a git repository calls `setup()` in each. A list of folders is kept at the file’s top level, so that one `cleanup()` removes them all.
    - It works, and each test reads alone. A helper that makes a once-per-group setup would cut the boilerplate.
    - The guide’s form `() => (ready ??= work())` passes Biome. The inline form `await (ready ??= work())` fails `lint/suspicious/noAssignInExpressions`. Confirmed.

11. **`ubqtest` 0.0.20 as a dependency.** `^0.0.20` allows 0.0.20 only, so each release is a change by hand. That fits a beta, but it is worth knowing.

## Notes on the way it was run

- The first pass used three sub-agents in one checkout. A plain `npx ubq` with no path runs every suite, browser tests too, and one sub-agent ran everyone’s tests that way by mistake. That is a cost of the setup, not of ubq.
- The first pass gave every test a limit of 60000 ms. The second pass took that out and gave a longer limit to the two tests that need one, so the default of 5000 ms still finds a hang everywhere else.

## whosonfirst-studio (a private repository)

The other repository is private, so its code is not linked here. It has two test files, for a script that pushes files to an R2 bucket and for its request signing. The tests start a small local server that stands in for the bucket, and run the script as a child process.

- **The conversion was quick.** `ubq convert test` made 29 changes, with 5 TODOs, all of one kind. `ubq doctor` had nothing to fix. 7 tests passed before and after, and `ubq check` passes.
- **The 5 TODOs** were assertions like `assert.equal(first.code, 1, first.said)`: the exit code, with the script’s output as the message. Each is now `assert.match(first, { code: 1 })`, so a failure shows the whole result, output included. That is as clear as before, and it is one line. (As problem 1 above says, the message could also have stayed.)
- **Coverage of the child process** needed nothing: the script the tests run with `execFile` is in the coverage of the test. Confirmed in `ubq sql`.
- **`ubq uncovered` led with “none” on partial data.** After the converted files were run once with `node --test`, out of habit, it printed `uncovered: none`, and only then the note `coverage is not complete for 2 test files ... (partial)`. The script run as a child was not in the coverage at all. With partial data, the first line could say so. Confirmed.
- **The project had no dependencies** until now, and its documents said “Nothing to install.” A test tool is now the one thing `npm ci` installs.
