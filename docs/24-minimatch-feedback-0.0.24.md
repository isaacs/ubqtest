# ubq feedback: converting minimatch from tap

Project: minimatch (TypeScript and JS tests, ESM, 38 tap test files, 8495 tap assertions, 6 tap snapshot files, 100% coverage enforced by tap). Tool: ubqtest 0.0.24 on Node 26.5.0, macOS. I did not test Windows, Bun, Deno, `ubq lsp`, `ubq mutate`, or `ubq server`.

Result: 37 test files, 442 tests, 8345 assertions, all pass. The assertion count matches tap file by file, except for two files where I removed exact duplicate cases (see "Duplicate test names"). All snapshot values match the tap values. A full run takes about 1.5s; tap took about 4.2s.

## Retest on 0.0.26

I upgraded the converted project to 0.0.26, and ran `ubq convert test` again on the original tap tests in a separate git worktree. The rest of this file is the 0.0.24 report, unchanged.

Fixed, and verified:

- Snapshot keys now include the message (`basic tests > !!a* hasMagic 1`). Because of this, I could compare each snapshot with its tap entry by key, not only by value. All match. The only key differences: tests that I named when I wrapped top-level code, the removed duplicates, and one message with a leading space (see below).
- `"coverage": "full"` works. I replaced my `posttest: ubq uncovered` script with it. When I removed one `ubq: not measured:` comment, `ubq` exited 1 with "1 range of code ran in no test".
- All duplicate test names are reported in one run (16 errors for the old `unc.ts`), and the other tests in the file still run (163 passed).
- convert no longer gives the false "vitest and jest" hint for `t.throws` with a partial object.
- convert maps `t.match(x, Matcher)` to `any.instanceOf(Matcher)` and `t.match(x, Symbol)` to `any.symbol`.
- convert changes `process.env.X = 'v'` in a test to `env({ X: 'v' })`.
- convert removes `t.plan()` when the parent became a `describe`.
- convert wraps top-level assertions in one `test()`, with a TODO to name it.
- convert gives a clear TODO for a helper that gets `t` and makes subtests, and for an async `describe` function.
- convert adds a TODO where it drops tap's last diagnostic argument.
- `ubq doctor` now finds `process.env` set above an import in both `optimization-level-0.ts` and `optimization-level-2.ts`.
- The guide now explains `include` vs `helpers`, the `not measured` comment on a ternary branch, and the tap subtest count. `erasableSyntaxOnly` is a note, not a `FIX`.

Still open, all minor:

- convert still writes `describe(platform, async () => { ... })` and adds a TODO. The TODO is clear, but the output does not work as-is.
- In `test/merge-rows.ts`, the top-level loop is next to other tests, so convert did not wrap it. That file still gets the old "This assertion is in no test" TODO.
- When convert wraps top-level code, a comment that described the first statement can end up above the TODO and the `test()` line. In `test/redos.js`, `// utility function for generating long strings` is now separated from the function it describes.
- After the upgrade, each old snapshot failed with "no code that it runs changed. The cause is in its data or its environment, or it is flaky". The real cause was the new key format in the ubq version. A note that names a ubq version change would be clearer, or a message that tells the user to run `ubq --update`.
- With `"coverage": "full"`, the failure says "See them: ubq uncovered". When the list is short, I would like it printed in the run output.
- The snapshot key trims the message: tap's `' hasMagic'` (empty pattern) became `basic tests > hasMagic 1`. This is fine, but it is one more key that does not map 1:1 from tap.

## Second project on 0.0.26: glob

I also converted node-glob with 0.0.26 (43 tap files, 1252 tap assertions, a tap `before` script, fs mocks, symlink fixtures, tests that skip on Windows). After the conversion, 263 tests pass and 1 is skipped. The assertion count matches tap file by file, with three known differences: two `assert.fail` loops became one `deepEqual` each (+2), one test that tap counted as a passing skip, and `native-fs-glob.ts`, which is now a plain script and not a test (see below). All 9 snapshots match tap, apart from the temp folder path. I upgraded nonrecursive-glob-match from 0.0.16 to 0.0.26 too: no change was needed, and all 1527 tests pass.

Many issues from the 0.0.19 report on glob are fixed: an Error instance in `t.rejects` becomes `{ message }`, a parent test body with side effects gets the "When a test runs" TODO, `t.plan(0, reason)` gets a TODO with the right fix, a helper that takes `t` gets a TODO, and `t.fixture('symlink')` gets a TODO that names `symlinkSync`.

New issues:

1. **A tap `before` script is converted as a test file.** `.taprc` had `before: "test/00-setup.ts"`. convert treated that file as a test: it wrote `test(file, { bail: true }, ...)` with a TODO for `bail`, and a TODO for `t.pipe`. The convert guide has the right advice ("make it a module that each test file imports"). convert could read `before` in `.taprc` and write that TODO at the top of the file. I rewrote it by hand as synchronous setup that is safe to run more than once, and added `import './00-setup.js'` to each of 19 test files that use the fixtures.
2. **A skip at the top level loses its reason, and `process.exit` stays.** In `progra-tilde.ts`, `t.pass('n/a', { skip: 'this system does not do tilde expansion' }); process.exit(0)` was at the top level. convert wrapped the file in a test, changed the line to `assert(true, 'n/a')`, and kept `process.exit(0)` in the test. The TODO talks about the assertion, not the exit. The reason text is lost. The correct form is `return skip('this system does not do tilde expansion')`, from the test function's `{ skip }`.
3. **A run where the only selected test is skipped exits 2, and the summary says `fail:`.** `ubq test/progra-tilde.ts` on macOS printed `fail: 0 failed, 0 passed, 1 skipped` and exited 2 ("no tests ran"). The test did run, and chose to skip. I expected exit 0, or at least not the word `fail`.
4. **No way to change `"coverage": "full"` for one run.** glob's CI allows incomplete coverage on Windows, because many tests skip there. ubq has no CLI flag or env var to turn the check off for one run, and the config has no per-platform form. So I removed `"coverage": "full"` and added `npx ubq uncovered` as a CI step on Linux and macOS. Now a local `npm test` does not fail for uncovered code. A flag such as `--coverage=off`, or a way to leave out code that only skipped tests would run, would let me keep the key.
5. **`ubq doctor` asks for `allowImportingTsExtensions` when `rewriteRelativeImportExtensions` is set.** The new `native-fs-glob.ts` script runs with plain `node`, so it imports `./bash-results.ts`. The ubq guide suggests `rewriteRelativeImportExtensions`, and with it `tsc` accepts the import. `ubq doctor` still prints `FIX tsconfig.json: set "allowImportingTsExtensions": true`.
6. **The mock hint does not cover a dependency of a dependency.** glob mocks `fs`, but only `path-scurry` (a package in `node_modules`) imports `fs`. Hint [13] shows only the one-step `mockImport` form. The guide has the two-step form (mock `fs` in an instance of `path-scurry`, then give that instance to glob), and it worked in 3 files. convert knows which project modules import the dependency. When none do, the hint could point to the two-step form.
7. **Mock types are strict for overloaded functions.** A mock `readdirSync: (path: string, options: any) => ...` fails the `MockOf<typeof fs>` type (TS2322), because `fs.readdirSync` has overloads. I needed `as typeof fs.readdirSync`, and for `realpathSync` with `.native`, `as unknown as typeof fs.realpathSync`. A sentence in the guide about this would help.
8. **A test that only warns has no good form.** `native-fs-glob.ts` used tap `todo` to print where Node's `fs.glob` differs from bash, without failing. In ubq I first used `skip(reason)` for each difference. In the end, the maintainer chose to make it a plain script (`npm run native-glob`) that prints the differences and exits 1 if there are any. This works well, but the converter and guide could suggest it: a test whose result is only a report is a script.
9. **Coverage of one branch depends on the order of the walks.** One `|| this.opts.stat` branch in `walker.ts` was covered in some runs and not in others. The cause is in glob, not ubq. But with `"coverage": "full"`, a flaky range fails a run with no hint. `ubq uncovered` could say when a range was covered in an earlier run of the same code.
10. **A `testdir` in a `describe` body is named `_file`.** The `root.ts` snapshots now contain `.ubq/testdir/test/root.ts/_file/...`. This is correct, but the name says nothing about the group. The 0.0.19 report also had this.

## What worked well

- `ubq convert test` did most of the work. It changed 36 files correctly in most places, and it ran prettier on the result. It also changed the `test` and `snap` scripts.
- `ubq doctor` found the old `tap-snapshots/` files and the test files that `ubq` would not run, and gave one clear fix for each.
- The convert note about file names gave the exact `include` snippet to paste. I used it as-is, and did not have to rename 36 files.
- The convert note listed each `c8 ignore` comment by line. That made the coverage part easy to find.
- Failure messages are very good. Each one names the test ID, the line, and a `rerun:` command. The error for a changed env var says the exact fix (`env({ NAME: value })`). The `assert.match` failure for a class in a pattern included a `note:` line with the real cause.
- The hint about ESM import order (`process.env.X = ...` above imports) is correct and found a real latent bug. In `test/optimization-level-0.ts`, the env var is set after `import './basic.js'` runs, so those tests never ran at optimization level 0, under tap too. (convert did not flag that file, see below.)
- `ubq sql` made it easy to count assertions per file and compare with tap. This is how I proved the conversion lost no assertions.
- `ubq uncovered`, `ubq check`, `ubq review`, and `ubq --repeat 3` all worked and gave clear output.
- No globals, one import, one `assert` object. The API was easy to learn from `ubq guide`.
- `mockImport(() => import(...), [])` to get a fresh module copy works well, and `env()` with automatic restore is a good fit for that.

## Bugs and wrong output from `ubq convert`

1. **Wrong hint for `t.throws` with a partial object.** 11 TODOs said "vitest and jest accept a string or an Error here" on tap code. In each case the value was a variable holding a partial object (`{ message: 'pattern is too long' }`), which `assert.throws` accepts. The hint names the wrong tools, and the TODO is not needed. Each TODO took 2 to 4 comment lines.
2. **`describe` with an async function.** A tap subtest `t.test(platform, async t => { ... t.test(...) })` became `describe(platform, async () => { ... })`. The guide says the `describe` function must be sync.
3. **`t.plan()` left as broken code.** convert left `t.plan(n)` with a TODO, so the file throws `ReferenceError: t is not defined` at load. Since convert already made the parent a `describe`, it could delete the line.
4. **Helper that receives `t` and calls `t.test` inside a test.** In `test/escape-literal.js`, a test called `runTests(t, ...)`, and `runTests` called `t.test(...)`. convert changed the inner calls to `test(...)`, so they would register tests from inside a running test. The TODO only said to remove the `t` argument. I restructured this by hand (a `describe` per platform, and a `load()` setup function in each test), so I did not see what ubq does with a test that registers tests.
5. **`t.match(value, Class)` keeps the class.** In tap, a class or a primitive constructor in a match pattern means "instance of" or "typeof". convert copied it as-is, and ubq calls it as a predicate function: `Class constructor Matcher cannot be invoked without 'new'`, and `Cannot convert a Symbol value to a string` for `Symbol`. Suggest: map a class to `any.instanceOf(Class)`, and `String`, `Number`, `Boolean`, `Symbol`, `Function`, `Object`, `Array` to the `any.*` matcher.
6. **`process.env.X = 'v'` inside a test is not converted.** Three tests in `test/win-path-sep.js` failed with "changed the environment variable ... did not put it back". The message gives the fix. convert could make this change itself when the value is a literal.
7. **Top-level assertions are not wrapped.** 12 files had assertions at the top level, and each got a TODO. I wrapped each one in one `test()` with a short script. convert could do this, with a test name from the file name, and a TODO to rename it.
8. **Extra diagnostic arguments are dropped with no note.** tap's last argument (`t.equal(a, b, msg, { pattern })`, `t.ok(x, msg, { ...timing, wanted })`, `t.same(a, b, msg, tapOpts)`) was removed. This is not wrong, but the info is lost from failure output. A TODO, or adding the values to the message, would help.
9. **The ESM import-order hint did not reach a file with no tap import.** `test/optimization-level-0.ts` only imports `./basic.js`, so convert reported it as "no known test tool" and did not check it. The env var bug in it is the same bug that convert flagged in `test/optimization-level-2.ts`. `ubq doctor` could check each test file for `process.env` set above an import.

## Things that were hard or surprising

### Duplicate test names

tap permits two subtests with the same name. ubq makes it an `ERROR` of the file. Two data tables had exact duplicate rows, and one had the same file and pattern with different options. Each run reported only the first duplicate in a file, so I needed three runs to find them all. Please report all duplicates in one run.

I removed the exact duplicate rows, and added the options to the group name for the third case. That is why `unc.ts` has 8 fewer assertions and `optimization-level-2.ts` has 6 fewer snapshots than under tap.

### Snapshot keys ignore the message

`assert.snapshot(value, message)` stores entries as `<test name> 1`, `<test name> 2`, and so on, by call order. The message is not part of the key. `basic tests` has 196 snapshots in one test, each with a unique message (the pattern). tap keyed them by the message. With order-based keys, a new case in the middle of the table changes the key of each later entry, and the snapshot diff is hard to review. I would much prefer the message in the key when one is given.

### Snapshot format differs from tap

The text format is close to tap's, but not the same: keys have no quotes, strings use single quotes, there is no `Array` / `Object` tag, and control characters print as `\x01` and not `\u0001`. So I could not diff the old and new files. I wrote a script that loads both, normalizes the text, and compares the values. All matched. A convert step that compares new snapshot values with `tap-snapshots/` before the user deletes it would remove this work.

### Counting assertions to compare with tap

The convert guide says to compare pass counts. tap's "Asserts" count includes one point for each subtest, and ubq counts tests and assertions separately. To compare, I ran tap per file and computed `ok` lines minus subtests, then compared with `ubq sql "select file, sum(asserts) from test where run=N group by file"`. A sentence about this in `ubq guide convert` would help.

### Coverage parity with tap

tap fails the run below 100% coverage. ubq has no threshold setting, so I added `"posttest": "ubq uncovered"`. I would like a config key for this (for example `"coverage": "full"`), so `ubq` alone is enough in CI.

Converting the `c8 ignore start` / `stop` regions to `// ubq: not measured: <reason>`:

- There is no range form, so a start/stop region does not map one to one.
- For the `: 'posix'` branch of a multi-line ternary, the comment above the statement did not cover the branch. It worked only when I put the comment on its own line inside the expression, above `: 'posix'`. The guide does not say how the comment works for a branch inside an expression.

### Per-test setup

ubq has no subtest, so setup that ran one time in a tap parent test now runs in each test. In `optimization-level-2.ts` each of about 70 tests now calls `env()` and `mockImport()` itself. This is correct and the docs explain why, but it costs more code than in tap. Run time was not a problem here.

### Other

- `test/patterns.js` is a data module that the tests import, not a test. tap ran it as an empty test. I added it to `exclude`. The default `helpers` glob (`**/{test,tests,__tests__}/**`) also matches each test file in `test/`. It is not clear how `include` and `helpers` interact. `ubq uncovered` said "1 test helper is not in this list", and I am not sure which file that is.
- `ubq doctor` marks `"erasableSyntaxOnly": true` in `tsconfig.json` as a `FIX`. The tests ran without it. A warning seems a better level for a change to the build config.
- `ubq convert --help` prints the full usage of each command, not help for `convert`.
- The home page says "one small API", but the API has about 20 exports. This is fine; just a note.

## Preferences

- I like: one import, no globals, the strict `deepEqual`, the `match` / `matchOnly` split, and the `any.*` matchers. The rule that a test with no assertions fails caught nothing here, but it is a good default.
- I like the run store and `ubq sql`, `ubq failures`, `ubq slow`.
- I do not like order-based snapshot keys (see above). This is my strongest request.
- I would like duplicate names to be a warning with an opt-in to fail, or at least reported all at once, since data-driven tests often have duplicate rows.
- The TODO comments from convert are long and repeat. One TODO per kind per file, with the line list, would be easier to work through.
