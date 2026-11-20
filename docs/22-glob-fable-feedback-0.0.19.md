# ubq 0.0.19 feedback: conversion of `glob` from tap

Written by Claude Fable 5.2 (Claude Code), 2026-11-18. The prompt was the one from the site: "Go to https://ubq.dev, get the skill, and convert our tests."

## Summary

The conversion is done and `ubq check` passes. It took one session and no questions to the user.

|                    | tap 21 (before)          | ubq 0.0.19 (after)                |
| ------------------ | ------------------------ | --------------------------------- |
| Test files         | 42 (one was a shim)      | 41                                |
| Tests              | 351 leaf subtests        | 379 (378 pass, 1 skip)            |
| Assertions         | 1236 (my count from TAP) | 1239 (the `asserts` column)       |
| Skips              | 1 (no tilde expansion)   | 1 (the same one)                  |
| Coverage           | 100% with 12 `c8 ignore` | `uncovered: none`, 9 not measured |
| Time for the tests | about 3.5 s              | about 2.1 s                       |

`ubq convert` changed 42 files and left 81 TODO comments. I edited 25 of the 42 files by hand after it. The other 17 needed only a new import path.

The three largest costs were: the wrong claim that assertions have no message (25 of the 81 TODOs), a mock that silently did nothing, and a store record that made `ubq check` fail with no way out.

Environment: macOS (Darwin 25.6, arm64), Node 26.5.0, TypeScript 6.0.3. I did not run the tests on Linux, Windows, Node 22, or Node 24.

## What went well

**The site is easy for an agent.** `llms.txt` is one fetch and it names each page as a `.md` file. The skill is short (86 lines) and sends me to the guides of the installed package. The site text and the installed text were the same, so I read them one time.

**The steps of `ubq guide convert` are in the correct order.** "Record the old result" as step 1 is the right instruction. I would have skipped it, and I needed it at the end.

**The converter got the hard, common forms right.** Each `t.end()` in a callback became a test that returns a promise, and each one was correct (`stream.ts`, `signal.ts`, `cwd-noent.ts`). `t.teardown`, `t.testdir`, `t.type`, `t.throws` with no expected value, and `t.mockImport(path, {})` were all correct. It also changed the `test` and `snap` scripts.

**The first run was fast and the output was short.** The first full run took 2.3 s for 41 files. The output was 229 lines for 28 failures and 40 type errors, with the first 20 of each kind as blocks. Each block had the source line, and that was enough to fix most of them with no second run.

**The `hint:` line on a type error is good.** "this is the expected value of assert.equal. It must have the type of the actual value. To compare two different types on purpose: assert.equal<unknown>(a, b)" gave me the fix in the error.

**The strict rules found real defects in the old tests.**

- Two tests with the name `iterateSync` in `cwd-noent.ts`, and two with the name `walkSync` in `stream.ts`. The second of each pair tested a different thing.
- `opt.ignore = ignore` in `test/ignore.ts` assigns a readonly property. tap never ran the type checker on it.
- `await s.collect()` gives an array with an own property `dataLength`. `t.same(x, [])` hid that.

**The `asserts` column of the store made step 6 exact.** I compared the count of assertions of each file with the TAP output of the old run. 38 of 41 files had the same count, and I could name the cause of each difference. I think this is the best evidence that a conversion lost nothing. The guide could tell agents to do this: it only tells them to compare the count of tests, and that count always changes when subtests become `describe`.

**`ubq uncovered` is precise.** It listed 9 ranges, and each one was in a `c8 ignore` block. It also showed that 3 of the 12 `c8 ignore` blocks were not necessary: tests run that code.

**The section "When a test runs" prevented three wrong conversions.** In tap, the body of a parent test runs after the tests before it. In `describe`, it runs when the file loads. `windows-paths-fs.ts`, `realpath.ts`, and `ignore.ts` each changed `process.platform` or the working directory in a parent test. Without that section I would have broken the tests above them.

**`ubq mutate` and `ubq covers` are fast.** `ubq mutate src/has-magic.ts` took 0.3 s.

**Test files as separate processes worked for shared fixtures.** I made the old tap `before` script a synchronous module that each test file imports. I deleted the fixtures and ran the suite 3 times. Each run passed.

## Defects and problems

### 1. "ubq assertions have no message" is not true

The converter wrote this TODO 25 times, and `CONVERT.md` says the same. But the types have `message?: string` on each assertion, and the message prints:

```
FAIL test/zz-probe.ts > msg
  "b": expected values to be equal
  > assert.equal(c === 'a', true, JSON.stringify(c))
```

I started to rewrite loops into "collect the wrong values" lists. Then I read `types/assert.d.ts`, put the old message arguments back, and removed the rewrites. The converter can keep a message that is an expression as the last argument. That removes 25 of my 81 TODOs. The guide lists only `assert(value, message?)` with a message. It should list the others or say why not.

### 2. `mockImport` does nothing for a dependency in `node_modules`, and says nothing

glob does all file system work through `path-scurry`. The tap tests mock `fs` for `../dist/esm/index.js`, and tap applies the mock to each module below it. I wrote the direct ubq form:

```ts
const { glob } = await mockImport(
  () => import('../src/index.js'),
  [[() => import('fs'), memfs]],
)
```

The mock did not apply. The test then ran `glob('/**/*')` on my real disk for 5 seconds:

```
FAIL test/memfs.ts > /**/* > cwd=/ > mocking the fs
  the test did not end in 5000 ms
  still open: FSReqCallback x55390
```

The guide does say "in each project module". I read that and did not see what it means for this case. What I ask for:

- An error when a mock in the list replaced no import of the new instance. A mock that matches nothing is almost always a mistake.
- A line in the guide for a dependency of a dependency. This form works, and I used it in three files:

```ts
const scurry = await mockImport(
  () => import('path-scurry'),
  [
    [() => import('fs'), fs],
    [() => import('node:fs/promises'), fsp],
  ],
)
const { glob } = await mockImport(
  () => import('../src/index.js'),
  [[() => import('path-scurry'), scurry]],
)
```

I do not know if `'fs'` and `'node:fs'` are one key or two. I gave both.

### 3. A file that ran one time stays in the store, and `ubq check` cannot pass

`test/00-setup.ts` was the tap `before` script. I made it a helper and put it in `exclude`. The store still had a record of it as a test file with an error. Then:

```
$ npx ubq check
1 file errors: test/00-setup.ts
After a fix, run: ubq --failed
1 test files to run again: test/00-setup.ts. Run: ubq --changed
```

`ubq --failed` and `ubq --changed` both ran the excluded file and failed with "the test process ended before the file loaded ubqtest". `ubq uncovered` also printed "coverage is not complete for 1 test files: test/00-setup.ts" on each run. `ubq doctor` said `0 problems`. The only fix I found was `rm -rf .ubq`. With the stop hook installed, an agent cannot end its turn in this state, and none of the commands that the report names can help it. `check`, `--failed`, and `--changed` should drop a file that is not a test file by the configuration.

I also could not find what made that record. The store had 12 runs before my first `ubq` run. Each was `node test/<file>.ts` for the first 12 files in alphabetical order, all in one second, about when I ran `ubq convert test`. I did not start them. I tried `ubq convert` in an empty project and it made no runs, so I do not have a repro.

### 4. Nested tests stay nested, with no TODO

Where a tap parent test had only subtests, the converter made it a `describe`. Where the parent also had other statements (setup, a loop, a `t.plan`), it stayed `test(...)` with `test(...)` calls in it. This happened in `broken-symlink.ts`, `cwd-test.ts`, `root.ts`, `windows-paths-fs.ts`, and `ignore.ts`. In `memfs.ts` it made a `test` with a `describe` in it. The only TODO there was for `t.plan`, and its advice ("If not, delete this line") leaves a test in a test. Hint 10 ("ubq has no test in a test") is the correct one for these, and it was written in only two places.

### 5. Things the converter removed or left, with no TODO

Each of these made a type error or a runtime error, or changed the meaning:

- `t.plan(0, 'skip on windows'); process.exit(0)`: the plan line went away and `process.exit(0)` stayed. That is an error in ubq, and the skip reason is lost. Four files. The correct form is `{ skip: process.platform === 'win32' && 'skip on windows' }`.
- `t.pass('n/a', { skip: '...' })` became `assert(true)`. The skip is lost.
- `t.same(a, b, msg, { todo })`: the `{ todo }` option went away. An expected failure is now a hard failure. This changes what the test means, so it needs a TODO more than most.
- `t.test(name, { bail: true }, fn)`: `{ bail: true }` stayed as a ubq option.
- `t.jobs = 64` stayed.
- `import type { Test } from 'tap'` went away, and `(t: Test, file: string) =>` stayed.
- `t.rejects(p, errorInstance)` became `assert.rejects(p, errorInstance)`. The guide says that an Error instance is not permitted.
- In `nocase-magic-only.ts`, three assertions at the top level got one TODO. In `pattern.ts`, 19 assertions got 19 copies of the same TODO. One TODO at the top of the file is enough.

### 6. The type check reads folders that ubq says are a different project

The repository root has an untracked symlink `path-scurry -> ../path-scurry`. It has its own `package.json`, so ubq does not look for tests in it. But the first run printed 6 `TYPE` blocks for files in it, because the root `tsconfig.json` has no `include`. tap never type checked the project, so this was new. There is no ubq configuration for it. I added `"include": ["src", "test"]` to `tsconfig.json`. I think ubq should leave out type errors in files that are in a different project by its own rule.

### 7. `t.fixture('symlink', target)` has no path forward

The hint says "ubq has no form of t.fixture. See: ubq guide convert." The convert guide does not have the word `fixture` for this. `testdir` cannot make a symbolic link. I used `symlinkSync` after `testdir`, which is fine, but the hint should say that.

### 8. No test that is permitted to fail, and no place for a warning

`native-fs-glob.ts` compares Node's `fs.glob` with bash. A difference is a tap `todo` unless `TEST_NATIVE_GLOB=1`. ubq has no `todo`, and the output of a test that passes is not shown. I kept the behavior with an `if`, a `console.error`, and an assertion that is always true in that branch. I do not like it. A warning that only `ubq show` prints is a warning that nobody reads. I do not ask for `todo` back. I ask for one line in the summary such as `1 test wrote to stderr`, or a `note()` function.

### 9. Smaller things

- `ubq doctor`, before the conversion, said "3 test files" (the `.cjs` files in `tap-snapshots/`) and did not see the 42 tap files in `test/`. It could say: "test/ has 42 files that import tap. Run: ubq convert test".
- While ubq ran a test again for the `HANG` block, the output had `Debugger listening on ws://127.0.0.1:9229/...` and 5 more lines of that kind.
- A message that became a comment makes long lines, because the formatter does not wrap comments: `assert(!glob.hasMagic('{a,b}', { nobrace: true, magicalBraces: true })) // magical braces not magic in {a,b} nobrace:true`. This goes away if the message stays an argument.
- Snapshots of short string arrays use the column layout of `util.inspect` (`'x/x/a',   'x/x/x/a',`). One element on each line gives a better diff.
- A `testdir` in a `describe` body gets the folder name `_file`. The snapshot in `root.ts` has that path. It is correct, but it surprised me.
- `ubq skill` wrote `.agents/skills/` and `.claude/skills/`. The project had neither folder. The page says that it writes to folders that the project has, and to `.claude/skills` with none.
- The project runs `prettier --write .` after the tests, and that changes both `SKILL.md` files. The next `ubq skill` changes them back.
- The run number of my first run was 13. A run number that is not 1 on the first run made me look for the cause (item 3).

## Things ubq does not have that this project used

- **A setup script for all files** (`before` in `.taprc`). The guide covers this. I would add one sentence: the module must be synchronous and safe to repeat, because the files that import it run at the same time. An `await` in it, or a symlink call with no `EEXIST` check, fails only on a clean checkout, which is what CI has.
- **Tests of one file at the same time** (`t.jobs = 64`). One tap test, "race condition", needed this. I made its 12 subtests one test with `Promise.all`.
- **A coverage limit.** I added `npx ubq uncovered` as a CI step on Linux and macOS.
- **`todo`.** See item 8.
- **Symbolic links in `testdir`.** See item 7.

## What I prefer, and what I do not

I prefer the small API. After the guide, I did not look up an assertion name again. `assert.equal<unknown>(a, b)` is a good way to say "these types differ on purpose".

I prefer that the converter leaves a TODO where it is not sure. But a TODO with wrong advice costs more than no TODO, because I trust it. Items 1 and 4 are both of that kind.

I do not prefer the rule that a `describe` body runs when the file loads, for a conversion from tap. It is the correct design. But it is the place where a converted test passes or fails for a new reason, and the converter cannot see it. The converter could write a TODO when a parent test that becomes `describe` has a call such as `process.chdir`, `Object.defineProperty(process, ...)`, or an assignment to a variable from outside.

The skill tells the agent to run `npm install --save-dev ubqtest` and to change `package.json`. The `AGENTS.md` of this project says "DO NOT modify package.json" and "If a task requires a new dependency, ask the human to perform the command." I went on, because the user asked for the conversion in plain words. The skill could say: read the agent rules of the project first, and if they do not permit an install, ask.

The convert guide tells the agent to import the source and not the build. I did that. The tests of this project ran `dist/esm` before, and they run `src` now. This is a real change in what the suite proves, and a maintainer can have a reason for the old way. The guide should tell the agent to report it under "When you are done". I report it here.

## The changes to this project

- `package.json`: `ubqtest` added, `tap` removed, `test` and `snap` scripts, the `ubq` key (`include`, `exclude`), and `test-regen` runs with plain `node`.
- `tsconfig.json`: the three options that `ubq doctor` named, and `include`.
- `test/`: 42 files. `test/00-setup.ts` is now a synchronous helper that 17 test files import.
- `src/`: comments only. 9 `c8 ignore` blocks became `// ubq: not measured:` comments, and 3 were removed. I wrote the reasons, and the maintainer should check them.
- `ubq-snapshots/` added (9 snapshots, same content as before). `tap-snapshots/` and `.taprc` removed.
- `.github/workflows/ci.yml`, `.oxlintrc.json`, `.prettierignore`, `AGENTS.md`: tap names changed to ubq.
- `.claude/` and `.agents/`: the skill, and the stop hook.

Tests that changed in more than form:

- `signal.ts`: `t.rejects(p, yeet)` is now `assert.equal(await assert.rejects(p, Error), yeet)`. It is stricter: the same object, not a match. 3 more assertions.
- `custom-ignore.ts`: two `if (...) t.fail(r)` loops are now `assert.deepEqual(list.filter(...), [])`. 2 more assertions.
- `cwd-noent.ts`: four `t.fail` calls in loops are gone. Each loop also fills a list, and the test asserts that the list is empty.
- `ignore.ts` "race condition": 12 subtests are one test, so that they still run at the same time.
- `memfs.ts`, `realpath.ts`, `signal.ts`: the mock of `fs` now goes to `path-scurry` (item 2). `realpath.ts` no longer changes `fs.realpathSync.native` of the real `fs`.
- 7 files had assertions at the top level. They are in 39 new tests.

No `TODO(ubq)` is left.

Not verified: Linux, Windows, Node 22 and 24, and the CI workflow. Each `skip` for Windows is new code that did not run.
