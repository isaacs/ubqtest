# ubqtest conversion report: Quiet Conquest

Feedback from converting a real project's suite from vitest to ubqtest 0.0.18, written for the ubq maintainers. The conversion was done by Claude (Opus 5.5) working as a coding agent, following the instructions on ubq.dev and in `ubq guide convert` as written.

## The project

- A TypeScript economic simulation game (Vite, Preact, Pixi), with its hot loops in Rust compiled to WebAssembly.
- 45 test files (41 "scenario" tests, 4 unit tests), 203 tests, about 4,200 lines.
- Scenario tests are synchronous and CPU-bound. Each builds a small world and runs it forward for simulated years (`runTicks(w, 52 * 20)`), then asserts on aggregate figures such as prices, staffing ratios and populations. The slowest takes about 7 s.
- Assertions are almost all numeric comparisons: 430 `toBe`, 178 `toBeGreaterThan`, 77 `toBeLessThan`, 35 `toEqual`/`toContain`, 18 `toBeCloseTo`. There are no mocks, timers, hooks, snapshots or DOM.
- pnpm, no formatter, semicolons throughout. The default Node is 22.22.0 (via nvm).

## Result

| | vitest 3.2.7 | ubqtest 0.0.18 |
| --- | --- | --- |
| Files | 45 | 45 |
| Tests passing | 203 | 203 |
| Skipped or failing | 0 | 0 |
| Wall time, Node 22.22.0 | 15.1 s | 16.2 s |
| Wall time, Node 25.2.1 | not measured | 11.3 s |

All 203 tests pass, under the same names. Changes beyond what `ubq convert` wrote:

- **Source:** two `const enum`s rewritten as `as const` objects (the owner's choice, see below), plus 4 follow-up type fixes in other source files.
- **Tests:** 15 `toBeCloseTo` tolerances corrected by hand (a converter bug, see below), and 9 type errors fixed (`!`, `assert(p !== null)`, and 2 cases of `assert.equal<unknown, unknown>`).
- **Config:** `"test": "ubq"`, vitest removed, the `test` block removed from `vite.config.ts`, `allowImportingTsExtensions` added to `tsconfig.json`, and `"ubq": { "build": [...] }` to mark `vite.config.ts` as a build tool.

`ubq check` still fails on one item: `src/worker/sim.worker.ts` changed and no test loads it (see item 10).

## What went smoothly

- **The converter got almost everything right with zero TODOs.** It made about 1,100 line changes across 45 files and flagged nothing ambiguous. On spot checks, `toBe`, `toContain`, `toMatch`, `toBeDefined`, `toBeNull` and the comparisons all converted correctly.
- **`ubq doctor` caught the real blockers up front.** It found the enum and the missing tsconfig flag, and its `FIX` lines were clear about what to do.
- **The instruction to stop and ask the owner about non-erasable syntax was right.** It's a real decision about source code, and the guide was explicit that the agent shouldn't make it alone. The owner picked one option in one question and the work went on.
- **The `--dry` report was a useful preview.** It listed per-file change counts and printed notes about `define` and Vite plugins, so it was clear what would happen before any file changed.
- **The integrated type check found a real weakness in an old test.** `path.test.ts` had `findPath(...)!` followed by `expect(p).not.toBeNull()`. The `!` made the null check meaningless to the type checker, and ubq's type error exposed it.
- **`.ubq/` needed no gitignore setup**, as promised.
- **On a passing run, the single-line output is a big improvement** over vitest's per-file listing when an agent is reading it.

## What didn't go smoothly or was confusing

Most severe first.

### 1. `toBeCloseTo(x, precision)` loses its precision argument (converter bug)

Every `toBeCloseTo` became `assert(Math.abs(a - b) < 0.005)`, which is vitest's default precision of 2, whatever the second argument was:

```ts
// before
expect(outputMult(w, c, near) / plain).toBeCloseTo(1 + T.neighbourBonus, 6);
// after ubq convert
assert(Math.abs((outputMult(w, c, near) / plain) - (1 + T.neighbourBonus)) < 0.005);
// correct: vitest's tolerance is 10 ** -p / 2
assert(Math.abs((outputMult(w, c, near) / plain) - (1 + T.neighbourBonus)) < 0.0000005);
```

15 of 18 calls passed a precision. With precision 5 or 6 the converted check was 1,000 to 10,000 times looser, which breaks the guide's own rule ("Do not make an assertion weaker"). With precision 0 it was 100 times stricter (`< 0.005` where vitest allowed `< 0.5`). The tests happened to pass either way, so nothing in the run would have exposed it. I found it only by reading the diff. The converter should emit `10 ** -p / 2` for each call, or write a TODO when `p` isn't a literal.

### 2. The Node version requirement is wrong in both directions, and the failure names nothing

The docs, `engines` and `ubq doctor` all say "Node 24 or later".

- **On Node 24.2.0, doctor printed `ok Node 24.2.0`, then every file failed to load** with an error that names no file or module:

  ```
  ERROR tests/scenarios/labor.test.ts
    the test file did not load: Expected a string, an ArrayBuffer, or a TypedArray to be returned for the "source" from the "load" hook but got null.
  ```

  All 45 files failed this way, which reads like a problem with the project, not the runtime. Running the file directly with `node` (as the guide suggests) gave a different, unrelated error: plain Node doesn't resolve extensionless imports. Switching to Node 25.2.1 fixed it.
- **On Node 22.22.0, the suite passed completely** (run 8 in the store records `node 22.22.0`), with no warning.

So the real floor looks like "a Node with a working `module.registerHooks` load hook", which 22.22 has and 24.2.0 doesn't. It would help if doctor tested that hook directly instead of the major version, if the load error named the URL the hook returned null for, and if the stated requirement matched what works. The suggestion to tell users to drop older Node versions from CI would have been wrong for this project.

### 3. The "since" line blames flakiness when a module-level constant changed

To try `--changed`, I bumped one tuning constant (`neighbourBonus: 0.15` to `0.16` in `src/sim/tuning.ts`). `--changed` correctly ran all 203 tests, and 2 failed. Both failure blocks said:

```
since run 4, where it passed, no code that it runs changed. The cause is in its data or its environment, or it is flaky: ubq --repeat 10 '...'
```

The cause was `tuning.ts:663`, a property of an object literal that runs at module load. My guess is that load-time code isn't attributed to individual tests. `--changed` still knew these tests depend on `tuning.ts`, so the dependency information exists; the `since` line just doesn't use it. In a project tuned through constants this happens all the time, and the line sends an agent off to check for flakiness. Naming changed module-level lines in files the test loaded would fix it. So would saying "no line that this test ran changed, but these files it loaded did".

### 4. The default time limit isn't enforced for synchronous tests

The guide says "A test that takes more than its time limit fails (default 5000 ms)". `ubq slow 4` shows six tests over 2.8 s and one at 6,776 ms, and all of them passed with no timeout configured. These tests are synchronous CPU work. As far as I can tell from the bundled code, the limit is a timer, which can't fire while a synchronous test is still running. Either the limit should be enforced from outside (`watchdog.js` exists, so perhaps that's the intent), or the docs should say it only catches tests that await something.

Related: vitest's config had `testTimeout: 60000`, with a comment explaining why. The converter didn't mention it or carry it into the `ubq.timeout` key. Here that didn't matter, because of the behavior above, but it would in an async-heavy suite.

### 5. Failed comparison assertions don't show the values

The converter turns `expect(x).toBeGreaterThan(0.5)` into `assert(x > 0.5)`, which affected 290 assertions here. When one fails, ubq prints:

```
FAIL tests/scenarios/labor.test.ts > ... > a glutted farm sheds hands while the bakery stays fully staffed
  expected a truthy value, got false
  at tests/scenarios/labor.test.ts:33:5
  > assert(bakeryStaff > 5);
```

vitest printed `expected 0.93 to be greater than 5`. For this suite the actual number is the most useful thing in the report. When a balance change breaks a scenario, the owner needs to know whether staffing fell to 0.49 or to 0.05. The guide says a failed `assert(value)` shows the values of its calls, but a bare variable isn't a call, so nothing shows. Showing the operands of a binary comparison (`bakeryStaff = 0.93`) would close this gap. A comparison assertion would also work.

### 6. Narrowing by `assert.equal` survives mutation and causes false type errors

Two tests check a field, mutate the world, then check the field again:

```ts
assert.equal(small.absorbedInto, undefined);   // narrows small.absorbedInto to undefined
runTicks(w, 52);                               // mutates small
assert.equal(small.absorbedInto, big.id);      // TS2345: 'number' is not assignable to 'undefined'
```

TypeScript keeps a narrowing of a property across function calls, so the narrowing feature of `assert.equal` turns a correct test into a type error. vitest's `expect` never narrows, so this only appears after conversion. The hint's escape hatch (`assert.equal<unknown, unknown>`) works but is noisy. It's also aimed at comparing different types "on purpose", which isn't what's happening here. Stateful simulations, state machines and stores will hit this often, so it deserves a specific hint, or a narrowing that doesn't apply to property paths.

### 7. The enum guidance is right, but the follow-through is left to the agent

- **Doctor named 6 files with non-erasable syntax, but only 1 is reachable from any test.** The other 5 (parameter properties in `src/render/`) are never loaded by the suite. Saying which files the tests actually import would have made the question to the owner smaller and more accurate.
- **Rewriting a `const enum` as an object isn't a one-file change.** Here it took 4 more edits elsewhere: members used as types (`RoadLevel.Dirt` must become `typeof RoadLevel.Dirt`), and a plain `number` no longer assignable to the union. A short recipe for this in the convert guide would save the trial and error.
- **The guide conflicts with itself on `erasableSyntaxOnly`.** Its Requirements section says to set it in `tsconfig.json`, but doing so would fail the project's type check on the `src/render/` files that the tests never run. Doctor didn't ask for it, which was the right call. The guide should say when not to set it.

### 8. Smaller things

- **The install step says `npm install` in a pnpm project.** I used `pnpm add -D` to avoid a second lockfile. The guide could say to use the project's package manager.
- **Converted imports drop the semicolon.** `import { assert, describe, test } from 'ubqtest'` was written without one in a codebase that uses them everywhere. The project has no formatter, so the converter's own style showed through. It could follow the style of the file's other import lines.
- **Unknown flags are read as paths.** `ubq mutate src/sim/path/astar.ts:54 --max-time 240000` answered "no test loaded --max-time. Run the tests first". An "unknown option" error would have been clearer.
- **`ubq slow` defaults to the last run.** After a one-file run, that means 3 tests. `ubq slow 4` was needed to see the whole suite. Defaulting to the last full run would match what people usually mean.
- **Step 2 asks to commit the install before converting.** I had been told not to commit, so this was skipped and the later diffs mix install, source and conversion changes. That's fine, but the guide could say what to do when committing isn't allowed.

### 9. `ubq review` can't see what the converter weakened

`ubq review` only compares ubq tests, as documented, so after the conversion it listed only the `ubq` config change. The `toBeCloseTo` problem in item 1 is exactly what review exists to catch, and it couldn't. A conversion mode would help: one that compares each converted test with its original by assertion count, or that flags changed numeric tolerances.

### 10. `ubq check` and files no test can load

- **`vite.config.ts` was flagged as "a changed file with code that no test loads".** I added it to `"build"`, which meant restating the default (`dist/**`, `scripts/**`) because the key replaces the rule. Including common config files (`*.config.*`) in the default would avoid this.
- **`src/worker/sim.worker.ts` still fails `check`.** It's the browser Web Worker entry, which no Node test can load, and my only change there was a type cast that emits no JavaScript. A change that's purely to types could be exempt. Otherwise the stop hook installed by `ubq skill` would block an agent on something it can't fix.

## What's better than the old setup

- **Failure blocks are excellent when the assertion is an equality.** They show the source line, actual and expected, the line that most likely caused the failure, and a rerun command:

  ```
  FAIL tests/unit/path.test.ts > pathfinding > finds a straight path on flat ground
    expected values to be equal
    at tests/unit/path.test.ts:11:12
    > assert.equal(p.length, 19);
    actual:   18
    expected: 19
    since run 4, where it passed, these lines that it runs changed: tests/unit/path.test.ts:11
    rerun: ubq tests/unit/path.test.ts:7
  ```

- **Coverage per test is useful in a codebase this coupled.** `ubq covers src/sim/path/astar.ts:72` listed the 56 tests that run that line. `ubq show <test>` lists every source file a test ran, which tells you a lot about what a scenario test really exercises.
- **Mutation testing is fast and targeted.** `ubq mutate src/sim/path/astar.ts:54` took 0.7 s, because it ran only the one test that reaches that line. The one surviving mutant was equivalent code (`r < Turnpike ? Turnpike : r` with `<=`), as the guide warns can happen.
- **The run store is useful for an agent.** `ubq failures`, `ubq show`, `ubq slow <run>` and `ubq sql` meant I never had to rerun a 12 s suite to reread a result. The run record includes the runtime, which is how I could prove run 8 was on Node 22.
- **The type check on every run** catches type errors in tests that the project's own `tsc` run would also catch, but at the moment they're introduced.
- **Rules that fail a test with no assertions or an unawaited promise** cost nothing in this suite and guard against a real class of agent mistake.

## What I don't prefer

- **Losing the values on comparison failures** (item 5) is the biggest cost for this suite.
- **Numeric closeness is now hand-written arithmetic.** `assert(Math.abs(a - b) < 0.0000005)` is harder to read than `toBeCloseTo(b, 6)`, and as item 1 shows, it's easy to get wrong. A numeric-closeness assertion would be worth its place even in a minimal API.
- **Node's type stripping forced a source change on a project whose source was fine.** The const enum was idiomatic, and Vite and esbuild handle it. The owner was asked and chose the change, but it's a real cost to adopting ubq, and it reached 5 source files.
- **`--changed` doesn't narrow anything here.** Every scenario loads the whole simulation, so any source change selects all 203 tests. That's inherent to the project, not a ubq defect, but the agent workflow built around `--changed` gives this kind of codebase no speedup.
- **No speed gain at the same Node version.** ubq took 16.2 s against vitest's 15.1 s on Node 22.22.0. The 11.3 s on Node 25.2.1 is a Node difference, not a ubq one.
