# ubq

A test tool for TypeScript and JavaScript, made for coding agents
and the people who work with them.

The package is `ubqtest`. The command is `ubq`. It runs on Node 24
or later, Bun, and Deno, with no build step and no configuration.

> **Status:** not released yet. Linux and macOS pass CI. Windows
> does not pass yet.

## Why a different test tool

An agent reads test output, decides, and runs a command again,
many times in one task. Most test tools print for a person at a
terminal: progress, colors, and a long report. ubq is made for
that loop.

- **Short output.** A pass is one line. A failure is one block
  with the place, the source line, the difference, and the
  command that runs that one test again.
- **Rules that catch a test that passes for the wrong reason.** A
  test with no assertion fails. A promise that nothing waits for
  fails. Work that goes on after the test ended fails. A test
  that leaves `process.env` changed fails.
- **One small API.** `test`, `describe`, `assert`, and a few
  helpers. No globals, no hooks, no `.only`. A form from a
  different tool, such as `assert.ok` or `test.only`, is a type
  error whose message gives the form to use.
- **Coverage for each test, always on.** ubq knows which tests
  ran each line. It uses that to run only the tests that a change
  can affect, and to answer questions.
- **A store of past runs.** Failures, history, and coverage are in
  a local SQLite file. An agent asks a question with a command and
  does not run the tests again to see the output.
- **The guide is in the package.** `ubq guide` prints the API and
  the rules for the installed version.

## Start

```
npm install --save-dev ubqtest
```

```ts
// test/parse.test.ts
import { assert, describe, test } from 'ubqtest'
import { parse } from '../src/parse.ts'

describe('parse', () => {
  test('circle', () => {
    const shape = parse('c')
    assert(shape) // narrows away undefined
    assert.equal(shape.kind, 'circle')
  })

  test('unknown input', () => {
    assert.throws(() => parse('?'), /unknown shape/)
  })
})
```

```
$ npx ubq
pass: 0 failed, 2 passed (run 1)
```

A failure:

```
$ npx ubq
FAIL test/parse.test.ts > parse > circle
  expected values to be equal
  at test/parse.test.ts:9:12
  > assert.equal(shape.kind, 'circle')
  actual:   'square'
  expected: 'circle'
  rerun: ubq test/parse.test.ts:6

fail: 1 failed, 1 passed (run 2)
```

A test file is also a plain program: `node test/parse.test.ts`,
`bun test/parse.test.ts`, `deno run -A test/parse.test.ts`.

## Commands

| Command | Does |
| --- | --- |
| `ubq` | Runs all test files (`*.test.ts`, `*.test.js`, and so on), and the type checker of the project. |
| `ubq <file>`, `ubq <file>:<line>`, `ubq '<test id>'` | Runs one file, one test, or one group. |
| `ubq --changed` | Runs the tests that ran code that changed after their last run. |
| `ubq --failed` | Runs the tests that failed in their last run. |
| `ubq --repeat <n> ...` | Runs tests n times and counts the failures of each, to find a flaky test. |
| `ubq --baseline <commit> ...` | Shows only the failures that the commit does not have. |
| `ubq failures`, `ubq show`, `ubq history`, `ubq diff`, `ubq slow` | Questions about stored runs. |
| `ubq uncovered`, `ubq covers <file>:<line>` | Code that no test ran. The tests that ran a line. |
| `ubq uncovered --diff` | Code that you changed and that no test runs. |
| `ubq mutate <file>`, `ubq mutate --diff` | A mutation check: small changes to the source, one at a time, and the list of changes that no test fails for. |
| `ubq convert <folder>` | Changes the tests of tap, `node:test`, vitest, jest, or mocha to ubq. |
| `ubq doctor` | Checks the setup of the project. |
| `ubq guide`, `ubq guide convert` | The guides, for the installed version. |
| `ubq server` | Optional. Keeps test processes ready, which makes runs faster. |

Exit codes: 0 pass, 1 failure, 2 no tests ran, 4 wrong command or
configuration.

## What a run does

- Each test file runs in its own process. Files run in parallel,
  in a random order. A run with a failure prints the seed.
- The type checker of the project (`tsc --noEmit`) runs at the
  same time, if the project has `tsconfig.json`. A type error
  fails the run.
- A test that goes over its time limit fails, and the report
  names what it left open and the line that opened it.
- A test file with a syntax error or a missing import is one
  `ERROR` block with the line.

## For coding agents

Tell the agent that the project uses ubq, and where the guide is.
For example, in `AGENTS.md` or `CLAUDE.md`:

```md
Tests use ubq (the ubqtest package). Before you write or run
tests, read `npx ubq guide`. Run `npx ubq --changed` after a
change, then `npx ubq uncovered --diff`.
```

`npx ubq skill` writes a skill for Claude Code to
`.claude/skills/use-ubq/SKILL.md`. The skill tells the agent to
read the guides of the installed package.

The guides are also files of the package: `GUIDE.md` and
`CONVERT.md`.

## Move a project to ubq

```
npx ubq guide convert   # the steps
npx ubq convert test    # the certain changes, and a TODO for each of the others
```

`ubq convert` knows tap, `node:test` with `node:assert`, vitest,
jest, and mocha with `node:assert`. It changes imports, test
definitions, and assertions. Where a person or an agent must
decide (hooks, subtests, module mocks), it writes a `TODO(ubq)`
comment with the instruction.

## Requirements and limits

- Node 24 or later, or Bun, or Deno.
- On Node, TypeScript runs with its types removed and no other
  change. Source with `enum`, `namespace`, or parameter
  properties does not load on Node. Bun runs it.
- `.tsx` and `.jsx` files run on Bun and Deno, with coverage.
- Tests of one file run one at a time. There is no DOM and no
  browser.
- Configuration is the `ubq` key of `package.json`: `include`,
  `exclude`, `timeout`, and two switches. Most projects need none.
  See [docs/08-config.md](docs/08-config.md).

## More documents

- [GUIDE.md](GUIDE.md): the API, the rules, and the commands.
- [CONVERT.md](CONVERT.md): how to move a project to ubq.
- [docs/api.md](docs/api.md): each export of the package, made
  from the type declarations.
- [docs/](docs/README.md): the design, the decisions and their
  reasons, measurements, and the status of the work.

## Development

```
npm install
npm test             # node src/cli.ts: the tool runs its own tests
npm run typecheck
npm run build        # the package, in dist/
npm run docs         # docs/api.md
```

The tests need `bun` and `deno` on the path. A test skips itself
if its runtime is not installed.

## License

[Blue Oak Model License 1.0.0](LICENSE.md)
