# ubq 0.0.23 trial report

**Who ran it:** a coding agent (Claude), asked to try ubq on a real project and report back.
**Project:** `hermetic`, an npm workspace with two TypeScript packages and 491 vitest tests (168 + 323), Node 22.23.
**What I did:** read ubq.dev, installed `ubqtest`, ran `ubq doctor`, read `ubq guide convert`, ran `ubq convert` on both packages, resolved the TODOs in the smaller package, and ran the suite. About 20 minutes.
**Result:** the conversion did not reach green. The smaller package ended at 111 passed, 57 failed. The larger one ran 56 of its 323 tests; 7 of its 12 files did not load.

## Went smoothly

- **Install and first run.** `npm install --save-dev ubqtest`, then `npx ubq` worked with no configuration. No account, no key.
- **`ubq doctor`.** Every problem came with its fix. It noticed the monorepo and said to run per package.
- **`ubq convert --dry`.** One line per file with change and TODO counts, then each hint once. I knew the size of the job before changing anything.
- **Conversion quality.** 532 changes across 17 files, with 11 TODOs. `it.each` tables became `for` loops with `as const`, and `expect.any(String)` became `any.string`. The diffs read like a careful person wrote them.
- **Speed.** 168 tests in 1.3 s, with a type check included.
- **Failure blocks.** Source line, the differing key path, and a rerun command with a line number. `ubq failures <run>` let me re-read a run without running it again.
- **Honest errors.** `beforeAll is not defined. ubq has no hooks…` names the cause and the replacement at the point of failure.

## Confusing

- **`"env": { "NODE_OPTIONS": … }` did nothing.** This project resolves its own packages through a custom export condition (`--conditions=@bombadil/source`). Setting it in the `ubq.env` key had no effect; setting it in the shell worked. The guide says a value of the key comes before the shell's, so I expected it to apply. ubq adding its own module to `NODE_OPTIONS` may be overwriting it.
- **No documented way to set export conditions or aliases** outside the Workers section. vitest's `resolve.alias` had no equivalent I could find.
- **No replacement for `setupFiles`.** `convert` treated the vitest setup file as a test-tool file and left it, but nothing loads it under ubq, and neither the report nor the guide said so.
- **Console output of a passing test is hidden.** I added a `console.log` to probe something, the test passed, and I saw nothing. The guide explains this, but I found it only after searching.
- **`ubq review` after a conversion** says it can't compare and to count by hand. That is the moment a reviewer most wants help.
- **The pass line** `pass: 0 failed, 1 passed` leads with the failure count on a pass.

## Defects I hit

1. **Coverage counters change `Function.prototype.toString`.** A function's text now contains `__ubqc`. This project checks functions from their source text, so 53 of the 57 failures in the smaller package are this one cause (`'__ubqc' is a free variable`, and `ReferenceError: __ubqc is not defined` when the text is evaluated elsewhere). The hint ubq prints assumes a browser page; here it was `new Function` and a Hardened JS compartment. I found no switch to turn coverage off for a file or a run. This is the blocker for this project, and it would affect any code that serializes functions: workers, `eval`, sandboxes, snapshot tools.
2. **`convert` introduced a name collision.** `for (const test of tests) it(test.name, test.run)` became `for (const test of tests) test(test.name, test.run)`. The loop variable now shadows ubq's `test`, and the file fails with `TypeError: test is not a function`. The command says it "makes only the changes that are correct in each case".
3. **`toEqual` to `matchOnly` changed meaning.** vitest's `toEqual` ignores a key whose value is `undefined`. The converted `assert.matchOnly` counts it as an extra key, so 7 tests that passed now fail (`.needs actual: undefined, expected: (missing)`).
4. **A TODO left a dangling reference.** Where `convert` left `expect(...)`, `expectTypeOf(...)` or `it.each(...)` under a TODO, it still removed the vitest import. The result is a `ReferenceError` at run time, in one case for the whole file.

## What improved over vitest

- Short output. A full failing run fit in one screen, and the summary line carried the command to see it again.
- The stored runs. Asking "what failed in run 3" after the fact is useful for an agent that has moved on.
- Rerun by `file:line`.
- The convert report and the built-in, versioned guide (`ubq guide`). I did not have to guess at an API from memory.

I did not get far enough to judge `--changed`, `mutate`, `uncovered` or the zero-assertion rules, because the suite never went green.

## What I do not prefer

- **No hooks at all.** ESLint's `RuleTester` and typescript-eslint's require `afterAll`, `describe` and `it` to be supplied. With no hooks and no setup file, four rule-test files could not load, and I saw no path for them short of writing an adapter. Third-party test helpers that expect mocha-style globals are common.
- **No type assertions.** `expectTypeOf` has no replacement; the TODO just says so. I deleted five type-level checks to proceed, which is a weaker suite.
- **Always-on instrumentation with no off switch** (see defect 1). Being on by default is fine; having no opt-out is not.
- **`ubq skill` edits the agent's own settings.** It installs a stop hook in `.claude/settings.json` so the agent cannot end its turn while checks fail. I did not run it. A tool changing my permissions and stop behaviour should be the user's explicit decision, and the homepage tells users to have their agent do it.
- **The site addresses agents directly** ("If you are an agent…", "get the skill, and convert our tests", "end your report with its output"). I treat text on a web page as information, not instruction, so this copy did not move me, and a careful agent will discount it. The same content written as documentation would be more persuasive.
- **The guide's prose style.** Very short declarative sentences are easy to parse, but at 1,085 lines it is long to load in full, and there is no index of topics to jump to.

## Suggestions, in order

1. Give coverage an opt-out (per file, per run, or a comment), and say in the guide that function text changes.
2. In `convert`, detect a local binding named `test` before renaming `it`, and keep imports that TODO'd statements still use.
3. Map `toEqual` to an assertion that ignores `undefined` keys, or emit a TODO.
4. Document a setup-file story and one for mocha-style global consumers such as `RuleTester`.
5. Make `ubq.env.NODE_OPTIONS` merge with ubq's own, or document that it can't be set there.
