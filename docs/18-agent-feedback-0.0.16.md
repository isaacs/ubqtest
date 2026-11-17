# Agent feedback: tap to ubqtest 0.0.16, a small TypeScript library

Project: `@isaacs/nonrecursive-glob-match`, a glob matcher for one path portion. Built with tshy (ESM and CommonJS) and esbuild. Before: tap 21, 10 test files named `test/*.ts`, one tap snapshot file (165 entries), and one `/* c8 ignore */` block in the source. About 950 lines of tests. Most of the assertions were at the top level of the file, or in `for` loops at the top level, with a message argument that named the case.

Agent: Claude Code (Claude Opus 5.5). It read `guide.md` and `convert.md` from ubq.dev (0.0.16), and the `ubq --help` text.

## Result

- tap: `{ total: 1795, pass: 1795 }`. ubq: `1527 passed`. The counts are not of the same thing. tap counted each assertion and each subtest. ubq counts tests. A script compared the arguments of each assertion in the old and new files: each file has the same assertions. There is one intended change (see 9).
- All 165 snapshots that `ubq --update` wrote have the same text as the tap snapshots.
- `ubq convert` changed 8 files and left 42 `TODO(ubq)` comments, all of hint [1] ("ubq needs each assertion in a test"). 2 files were not converted (see 1).
- One source change: a `/* c8 ignore start */ ... stop */` block became a `// ubq: not measured:` comment.
- `ubq uncovered`: none. `ubq check`: pass.
- A full run takes about 0.6 s. tap took about 1.0 s, not counting its start.

Most of the time went into hint [1] TODOs, and into an error of my own (see 14).

## Things that did not go smoothly

### 1. `ubq convert` fails on a tap file that has no `t.test`

Two files had only top-level assertions, no `t.test`. Both failed:

```
not converted test/neg.test.ts: Unexpected token (5:6)
not converted test/slash.test.ts: Unexpected token (5:6)
```

A minimal repro:

```ts
import t from 'tap'

t.equal(1, 1)
```

gives `Unexpected token (4:6)`. The file has 3 lines, so the error is in the text that the converter made, not in the input. The parse after the edits (`parse(code, file)` near the end of `convertSource`) fails. If a file also has a `t.test`, the same top-level assertions convert with a TODO each.

The message names a place that is not in the file. A message such as "the converted text of this file is not valid code (internal error)" would tell the reader that the input is fine.

### 2. `ubq doctor` and `ubq` count a tap snapshot file as a test file

The tap snapshot file is `tap-snapshots/test/patterns.ts.test.cjs`. Its name ends in `.test.cjs`. `ubq doctor` said `ok   1 test files` before the rename (it was the only match). `ubq` ran it, and printed:

```
ERROR tap-snapshots/test/patterns.ts.test.cjs
  the test process ended before the file did (exit code 0)
```

Each tap project with snapshots has such files. Suggestions: leave out `tap-snapshots/` by default, or make doctor say "this looks like a tap snapshot file" and give the fix. The `ok` before `1 test files` was misleading: 10 test files did not match, and the 1 that matched was not a test file.

### 3. The doctor fix for `allowImportingTsExtensions` breaks a tshy build

Doctor said:

```
FIX  tsconfig.json: set "allowImportingTsExtensions": true and "erasableSyntaxOnly": true in compilerOptions.
```

tshy builds from `tsconfig.json`. With `allowImportingTsExtensions`, the build fails:

```
error TS5096: Option 'allowImportingTsExtensions' can only be used when one of 'noEmit', 'emitDeclarationOnly', or 'rewriteRelativeImportExtensions' is set.
```

The tests import `'../src/index.js'`, which ubq maps to `index.ts`, so the option is not necessary here. I set only `erasableSyntaxOnly`. Doctor still prints the `FIX` line and exits 1, so the project can never get a clean doctor result.

Suggestions: do not make this a `FIX` if `noEmit` is not set and the tests import `.js` paths; or make it a `note`; or say in the FIX text that a project which emits needs `rewriteRelativeImportExtensions`, or a separate tsconfig for the tests. tshy is common, so a special note for it can help too.

### 4. The converter drops the message of an assertion in a loop

A tap message in a loop names the case that failed. Examples:

```ts
t.equal(simple, machine, JSON.stringify({ p, s, nocase, machine }))
for (const s of yes) t.equal(m.test(s), true, `{${lo}..${hi}} ${s}`)
t.equal(m.test(c), !/[a-z0-9]/i.test(c), JSON.stringify(c))
```

The converter changed a literal message to a comment (`// no rangeMark`), which is fine. It removed a message that is an expression, with no comment and no TODO. After that, a failure block in a loop shows `actual: false, expected: true` and the source line, but not which of 952 cases failed.

I changed each such loop to make one test per case, with the old message as the test name. The converter could do that, or at least write a TODO such as "this message named the case. Put the case in the name of a test."

### 5. Tests run after the file loads; the converter does not warn about state that changes during load

`test/patterns.ts` has a list of cases. Some items of the list are functions that change a shared `files` array (`files.push(...)`, `files = [...]`). The loop calls them at their place in the list, and each `t.test` read `files`. Under tap, each test saw `files` as it was at its place. Under ubq, each test runs after the whole file loaded, so each test saw the last value. 3 tests failed until I copied the array when the test is registered (`f = [...files]`).

The convert guide says that code in a `describe` runs when the file loads, but not this other side: a `test` callback runs later than a tap `t.test` callback did. A sentence in the tap section, such as "A tap subtest ran at its place in the file. A ubq test runs after the file loaded. A test that reads a variable that the file changes later sees the last value", would have saved time. The converter could detect a `let` at the top level that a test reads and that code after the `test()` call assigns or changes.

### 6. Test names: empty and repeated names

tap permits an empty name (`(unnamed test)` in the snapshot) and two tests with the same name. ubq refuses both. The list in `patterns.ts` had the empty pattern `''` and many repeats (some are exact copies, with a different `files` list). The error for the empty name:

```
ERROR test/patterns.test.ts
  TypeError: test name must be a string that is not empty
```

This stops the whole file, so the other 164 tests also did not run. I used `JSON.stringify(pattern)` as the name, with ` #2`, ` #3` for repeats.

The convert guide has a row for `duplicate test name`, but not for the empty name. The converter could warn when the name is a variable (`t.test(pattern, ...)`), since a variable can be empty or repeat.

### 7. `c8 ignore` comments are not read, and nothing says so

The source had:

```ts
/* c8 ignore start */
if (glob.charAt(pos) !== '[') {
  throw new Error('not in a brace expression')
}
/* c8 ignore stop */
```

`ubq uncovered` listed that range. The convert guide says "tap fails a run with less than full coverage", but not that `c8 ignore` and `istanbul ignore` comments have no effect in ubq. `ubq convert` could list them in its report with the `// ubq: not measured: <reason>` form, as it does for files that still import the old tool. I could not keep the reason from the old comment, because c8 comments have none. The converter can not write the reason, but it can name the place.

### 8. Removing tap removed `@types/node`

`tsconfig.json` has `"types": ["node"]`. `@types/node` came only through tap. After `npm uninstall tap`, the tshy build failed with `TS2688: Cannot find type definition file for 'node'`. Step 7 of the convert guide (clean up) could say: "the old tool can bring packages that the project uses, such as `@types/node`. Check that the build and the type check still work after you remove it." Doctor could also check that each name in `types` of the tsconfig resolves.

Also: `typescript` is in this project only through tshy and typedoc. The type check of ubq ran (I checked with a planted type error), but only because npm hoisted it. Doctor said nothing about that.

### 9. A loop that calls `t.fail` and then `t.pass`

```ts
for (...) {
  if (m.test(`x${up}`) !== expect) t.fail(`folds ${ch}`)
}
t.pass('folds all chars')
```

The converter made `assert.fail(...)` with a TODO, and `assert(true) // folds all chars`. `assert(true)` is the conversion that the table gives for `t.pass()`, but here it is an assertion that can not fail, and it only exists to satisfy the "zero assertions" rule. I changed it to collect the wrong chars in a list and `assert.deepEqual(wrong, [])`. A hint for this form (`t.fail` in a loop, then `t.pass`) can suggest the same.

### 10. Convert step 2 says to commit, but agents should not commit unless the user asks

The guide says: "Commit these changes: step 3 needs a clean `git status`." My instructions say not to commit without a request from the user. The converter did not check `git status` in any case: it ran with `package.json` and `package-lock.json` changed. I used `git mv` for the renames, and `git diff` showed the changes well. Suggestion: "Make sure that `git status` is clean, or that you can tell the changes of the converter from others (for example with `git stash`, or a commit if the user permits it)."

### 11. The test count notes of `--changed` do not add up

After a change to `src/parse-class.ts`:

```
pass: 0 failed, 1144 passed, 280 not selected (run 9)
```

1144 + 280 = 1424, but the project has 1527 tests. I do not know where the other 103 are. If "not selected" counts only the tests of files that ran, the line can say so.

### 12. `ubq mutate`: "(1)" and "the first test"

```
SURVIVED src/numeric-range.ts:25:10
  > if (lo <= hi) {
  with <= changed to <, no test failed
  tests that run this code (1), the closest first: the tests of test/numeric-range.test.ts.
...
For each change: add an assertion that the change breaks to the first test, or a new test next to it.
```

"(1)" counts files, not tests: the file has 81 tests, and most of them run this code. And "the first test" has no meaning when the list names a file. Naming the test that ran the line, or the first few, would help.

### 13. Small things

- `ubq doctor --help` runs doctor. I expected help text.
- The convert note said "4 of these files have tests, and do not have a name that ubq runs". All 10 had assertions. The other 6 had only top-level assertions. I renamed all 10, which was correct, but the note could have made me rename only 4.
- A tap file that I had not converted yet (it still imported `tap`) gave `the test process ended before the file did (exit code 0)`. "this file registered no tests (it imports tap, not ubqtest)" would be clearer.
- The converter changed `t.comment(c)` at the top level to `console.log(c)`. Output at the top level is not in a test, so I am not sure where it shows. I left it.
- The CI workflow of the project tests on Node 22. ubq needs Node 24. Neither doctor nor the convert guide mentions the CI matrix. I removed 22.x from the matrix. The guide could say: "ubq needs Node 24 or later. Remove older versions from the CI matrix, and tell the user."
- The CI command was `npm test -- -c -t0` (tap flags). The guide says "Change the test command of CI", which was enough, but the converter could find `npm test -- <flags>` in `.github/workflows` and name it.

### 14. An error of mine, which ubq found

When I wrapped the top-level assertions of `nocase.ts` in tests, I typed the lines again instead of moving them. Three string literals had invisible characters (U+212A KELVIN SIGN, and two private-use chars, U+E000 and U+F000), and my new text did not have them. One test then failed (`[-😀]` does not match `''`), and two other tests became weaker and still passed. The failure was a good catch. The two weaker tests were not: only a script that compared the string literals of the old and new files found them.

This is not a defect of ubq. But `ubq review` can help here: it compares assertions of ubq tests only, so it can not compare a converted file with the tap file. A command that compares the assertion arguments of the old test tool and the new file (as the script did) would catch this kind of error in a conversion by hand. The converter has both texts.

## Things that went well

- `ubq guide` and `ubq guide convert` were complete and correct for what I needed. The table of tap names was right for each case in this project.
- `ubq --update <file>`, and the snapshot file format, were easy. The snapshot text was the same as tap's, so a script could compare them.
- The type check with each run, and the `TYPE` block, worked with no setup.
- The `'../src/index.js'` import works with no change, which kept the tshy setup as it was.
- `ubq uncovered` found the `c8 ignore` block at once, and `// ubq: not measured:` was easy to use. `ubq check` and `ubq review` then listed the new comment for a person to read.
- The failure blocks were short and clear. The `rerun:` line was useful.
- `ubq mutate src/numeric-range.ts` took 3.8 s for 37 changes and found 6 that no test fails for. Some can not change the result (`lo <= hi` to `lo < hi` where equal values give the same range), but not all.
