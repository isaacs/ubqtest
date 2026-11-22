# ubq 0.0.29, tried on a real project

A second trial by a coding agent (Claude), after the fixes that followed the 0.0.23 report. The suite now goes green.

Project: `hermetic`, an npm workspace with two TypeScript packages and 491 vitest tests, on Node 22.23. Fresh branch, `ubq doctor`, `ubq convert`, every TODO resolved, then `check`, `review`, `uncovered`, `--changed` and `mutate`. About 25 minutes. 22 November 2026.

0.0.23 fail: 57 failed, 111 passed · 7 of 12 files did not load 0.0.29 pass: 168 tests · pass: 323 tests · workspaces: 2 passed vitest 491 passed

## What was fixed since 0.0.23

| Reported | Now |
| --- | --- |
| Coverage counters showed up in `fn.toString()` (53 failures) | Fixed. Function text is the source. Tests that read it, evaluate it with `new Function`, or run it in a Hardened JS compartment all pass, and the config guide says so. |
| `"env": { "NODE_OPTIONS": "--conditions=…" }` did nothing | Fixed, and documented with this exact case. |
| `convert` renamed `it` to `test` under a loop variable named `test` | Fixed. The loop variable became `testCase`. A local function named `describe` got a TODO, which is the right call. |
| TODO'd statements lost their import | Fixed for test files. The old import stays and the report lists files that still name the old tool. One case remains, below. |
| No `expectTypeOf` replacement | `assert.type<Actual, Expected>()` exists, and the type-argument form converts by itself. |
| No story for `RuleTester` | The convert guide has a recipe. It worked for ESLint's tester and typescript-eslint's. |
| `toEqual` and `undefined` keys | The failure now carries a hint naming the cause and both fixes. Still a failure after conversion. |
| One 1,085-line guide with no index | Split into a 510-line guide with a topic table, `guide convert` and `guide config`. |
| Pass line led with `0 failed` | Now `pass: 168 tests (run 7)`. |

That is every item from the first report except hooks, which is a design choice, and the agent-directed copy on the site, which was not re-read.

## Went smoothly

- **ok**

  Install, `doctor`, the dry run, the diffs and the failure blocks all held up as before.
- **ok**

  **Hints inside failures are the best part of the tool.** "the test changed the environment variable NODE_ENV and did not put it back. Use env({ NODE_ENV: value })" gave the fix without a search.
- **ok**

  `ubq --changed` ran 11 of 168 tests in 0.6 s after a one-line edit, and named the file that changed.
- **ok**

  `ubq mutate src/inject.ts` made 11 changes in 2.3 s. Two survived, each shown with its source line and nearest tests. Both are real gaps in this project's tests.
- **ok**

  `ubq check` is one line on a pass, and refused to pass while a source file was newer than its last run.
- **ok**

  Running from the workspace root needed no setup.

## Rules that caught something real

- **ok**

  **Duplicate test name.** A rule-test file had the same case twice. vitest ran both without comment.
- **ok**

  **Zero assertions.** Three generated tests asserted through a mechanism ubq can't count.
- **ok**

  **Environment not restored.** Vite sets `NODE_ENV` during a build, and the test never put it back.

## Defects

- **fail**

  **`convert` left a dangling name in the setup file.** `tests/setup.ts` came out with `RuleTester.afterAll = afterAll;`, no import of `afterAll`, and no TODO on that line. The two `test.only` lines beside it did get TODOs.
- **fail**

  **`toEqual` still converts to an assertion that fails.** Seven tests that pass under vitest fail after `convert`, for the `undefined`-key reason. The command says it "makes only the changes that are correct in each case".
- **fail**

  **The hooks hint is wrong when order matters.** For `beforeAll(() => lockdown())` in a `describe`, the TODO says to put sync work in the `describe` function. A test outside that group, which must run before `lockdown()`, then failed, because `describe` bodies run at load. The lazy `ready ??=` form is the safe one.
- **fail**

  **The setup file got no note.** The guide says a vitest `setupFiles` entry gets one. The config is at the workspace root, the conversion ran inside a package, and nothing appeared.

## Confusing

- **note**

  `expectTypeOf(expr)` with an expression gets a TODO, while the type-argument form converts. The reason is sound (`typeof` needs a name) but the TODO doesn't say "bind the expression to a const first".
- **note**

  A group-level `afterAll` has no clean equivalent. `cleanup()` is per test. Removing a temp folder when the file is done took `process.on("exit")`.
- **note**

  `ubq review` after the conversion reported one change, the config key. It did not mention that 20 files changed tool, or the `assert(true)` adapters that were added.
- **note**

  `ubq mutate` after a `git checkout` of a file said it "changed after the last run". True, but the content was back at the committed state. A content hash would save a rerun.
- **note**

  Run numbers continued from the earlier trial on a fresh branch, because `.ubq/` is ignored by git.

## Improved over vitest

- **ok**

  Short output, stored runs, and rerun by `file:line`, now confirmed on a passing suite.
- **ok**

  `--changed`, `mutate` and `check` answer "which tests cover this line" and "would any test notice this change". vitest has nothing built in for either.
- **ok**

  The three rule catches above.

## Not preferred

- **note**

  **The `assert(true)` idiom.** The zero-assertion rule is good, but its official workaround for `RuleTester` is an assertion that asserts nothing. That teaches the pattern the rule exists to stop. A named escape, or counting `node:assert` calls, would keep the rule honest.
- **note**

  **No hooks, still.** Workable now that the guide covers the cases, but each one cost a hand edit.
- **note**

  **Speed on the larger package.** 323 tests took 8.3 s, and the workspace 9.0 s against vitest's 7.7 s for all 491. The small package is fast at 1.3 s. Workspaces run one after the other.
- **note**

  **`ubq skill` and its stop hook.** Not run, as before. Changing an agent's settings so it cannot end its turn should be the user's explicit choice.

## Suggestions, in order

1. Make the `toEqual` conversion pass where vitest passed, or leave a TODO.
2. Fix the dangling `afterAll` in converted setup files, and emit the setup-file note when the config is in a parent folder.
3. Replace `assert(true)` with a first-class way to say "this test asserts through another library".
4. Reword the hooks hint so the order-safe form comes first.
5. Have `review` list files that moved from another tool, and flag constant-true assertions.