# ubq feedback: converting minimatch from tap

Project: minimatch (TypeScript and JS tests, ESM, 38 tap test files, 8495 tap assertions, 6 tap snapshot files, 100% coverage enforced by tap). Tool: ubqtest 0.0.24 on Node 26.5.0, macOS. I did not test Windows, Bun, Deno, `ubq lsp`, `ubq mutate`, or `ubq server`.

Result: 37 test files, 442 tests, 8345 assertions, all pass. The assertion count matches tap file by file, except for two files where I removed exact duplicate cases (see "Duplicate test names"). All snapshot values match the tap values. A full run takes about 1.5s; tap took about 4.2s.

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
