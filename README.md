# ubq

A test tool for TypeScript and JavaScript, made for coding agents
and the people who work with them.

The package is `ubqtest`. The command is `ubq`. It runs on Node 22.18
or later, Bun 1.4 or later, and Deno, with no build step and no configuration.

> **Status:** early. The versions are 0.0.x, and the API can
> change. CI passes on Linux, macOS, and Windows, with Node, Bun,
> and Deno.

## Why a different test tool

An agent reads test output, decides, and runs a command again,
many times in one task. Most test tools print for a person at a
terminal: progress, colors, and a long report. ubq is made for
that loop.

- **Short output.** A pass is one line, with a line before it for
  each skipped test. A failure is one block with the place, the
  source line, the difference, the lines that the test ran and
  that changed after its last pass, and the command that runs
  that one test again.
- **Rules that catch a test that passes for the wrong reason.** A
  test with no assertion fails. A promise that nothing waits for
  fails. Work that goes on after the test ended fails. A test
  that leaves `process.env` changed fails.
- **A simple API.** `test`, `describe`, `assert`, the four hooks
  of jest and vitest, and a few helpers. One pattern form for "looks like this", with
  `any.number`, `any.arrayWith(...)`, and the other functions of
  `any` for the parts that change. No globals and no `.only`. A form from a
  different tool, such as `assert.ok` or `test.only`, is a type
  error whose message gives the form to use.
- **A DOM for component tests.** The `dom` key gives a test file
  the DOM of jsdom or of happy-dom before it loads. Testing
  Library works with no setup file.
- **Coverage for each test, always on.** ubq knows which tests
  ran each line. It uses that to run only the tests that a change
  can affect, and to answer questions.
- **A store of past runs.** Failures, history, and coverage are in
  a local SQLite file. An agent asks a question with a command and
  does not run the tests again to see the output.
- **The guide is in the package.** `ubq guide` prints the API and
  the rules for the installed version, and a list of topics: `ubq
  guide <topic>` prints one.

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
pass: 2 tests (run 1)
```

Put this script in `package.json`:

```json
"scripts": { "test": "ubq" }
```

`npm test` runs the tests. `npx ubq --update` runs them and
writes the snapshots of `assert.snapshot`.

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

fail: 1 failed, 1 passed (run 2: ubq failures 2)
```

A test file is also a plain program: `node test/parse.test.ts`,
`bun test/parse.test.ts`, `deno run -A test/parse.test.ts`.

## Commands

| Command | Does |
| --- | --- |
| `ubq` | Runs all test files (`*.test.ts`, `*.test.js`, and so on), and the type checker of the project. |
| `ubq <file>`, `ubq <file>:<line>`, `ubq '<test id>'` | Runs one file, one test, or one group. |
| `ubq run <paths>` | The same, for a path with the name of a command, such as a folder `diff`. |
| `ubq lsp` | A language server: the editor shows the code that no test ran, the failures of the last run, and the tests of a line. It runs the tests of a line, and goes to them. |
| `ubq nvim` | Sets up Neovim (0.12 or later) to use `ubq lsp`. A VS Code extension is in `vscode/`. |
| `ubq --changed` | Runs the tests that ran code that changed after their last run, new test files, and the tests that failed in their last run. |
| `ubq --failed` | Runs the tests that failed in their last run. |
| `ubq --repeat <n> ...` | Runs tests n times and counts the failures of each, to find a flaky test. |
| `ubq --baseline <commit> ...` | Shows only the failures that the commit does not have. |
| `ubq --max-time <ms> ...` | Stops the run after that time. Each file that did not end is an error. |
| `ubq failures`, `ubq show`, `ubq history`, `ubq diff`, `ubq slow` | Questions about stored runs. |
| `ubq sql <query>` | A read-only SQL query on the store of runs. See [docs/store.md](docs/store.md). |
| `ubq uncovered`, `ubq covers <file>:<line>` | Code of the program that no test ran (exit code 1 if there is some). The tests that ran a line. |
| `ubq uncovered --diff` | Code that you changed and that no test runs. |
| `ubq check` | Checks that the last result of each test is a pass, that it is the result of the code as it is now, and that each changed line ran in a test. Runs no test. On a pass, it lists the changes to the tests to look at: the output is the evidence for the last message of an agent or a pull request. `--hook`: a stop hook for a coding agent. |
| `ubq review` | The changes to the tests that a person must look at: tests removed or skipped, fewer or changed assertions (and if the test runs changed code), changed snapshots, and new `not measured` comments. A converted file is compared with the tests of the old tool. |
| `ubq status` | The runs in progress: the files that run now, the test that runs in each, and for how long. |
| `ubq merge <store>...` | Adds the coverage of other stores, such as those of CI jobs on other runtimes and systems. |
| `ubq mutate <file>`, `ubq mutate --diff` | A mutation check: small changes to the source, one at a time, and the list of changes that no test fails for. |
| `ubq convert <folder>` | Changes the tests of tap, tape, ava, `node:test`, vitest, jest, `bun:test`, mocha, or Playwright Test to ubq. |
| `ubq convert --transform=<name>` | Sets up a compiler (`typescript` or `swc`) for source that Node cannot run with only its types removed. |
| `ubq browser install` | Downloads the browser for tests that use `'ubqtest/browser'`. |
| `ubq doctor` | Checks the setup of the project. |
| `ubq guide`, `ubq guide <topic>`, `ubq guide convert` | The guides, for the installed version: the core and its list of topics, one topic (`all` for the whole guide), and the steps to move a project to ubq. |
| `ubq server` | Optional. Keeps test processes ready, which makes runs faster. |

`ubq --help` lists all commands. `ubq <command> --help` prints
the lines of one command.

Exit codes: 0 pass (also if each test skipped), 1 failure, 2 no
tests matched, 4 wrong command or configuration.

## What a run does

- Each test file runs in its own process. Files run in parallel,
  in a random order. A run with a failure prints the seed.
- The type checker of the project (`tsc --noEmit`) runs at the
  same time, if the project has `tsconfig.json` and the
  `typescript` package. A type error
  fails the run. A run of a selection fails only for the type
  errors of the files that it used. The `skipTypecheck` key of
  the configuration turns the check off.
- A test that goes over its time limit fails, and the report
  names what it left open and the line that opened it.
- A test file with a syntax error or a missing import is one
  `ERROR` block with the line.
- In GitHub Actions, each failure and type error is also an
  annotation at its line in the view of the changes of a pull
  request. `ubq uncovered --diff` does the same for changed code
  that no test ran. The summary of the job gets a table of the
  failures.

## For coding agents

Tell the agent that the project uses ubq, and where the guide is.
For example, in `AGENTS.md` or `CLAUDE.md`:

```md
Tests use ubq (the ubqtest package). Before you write or run
tests, read `npx ubq guide`. Run `npx ubq --changed` after a
change. Before you say that the work is done, run `npx ubq check`,
and end your report with its output.
```

`npx ubq skill` writes a skill (`use-ubq/SKILL.md`) for coding
agents. It writes to each skill folder that the project has
(`.claude/skills`, `.cursor/skills`, `.agents/skills`, and others
of that form), and to the folder of the agent that runs the
command: Claude Code, Cursor, Gemini, Copilot, Codex, or
Antigravity. With
none of these, it writes to `.claude/skills`. To select the
place, name the agent or a folder: `npx ubq skill cursor`, `npx
ubq skill .myagent/skills`. The skill tells the
agent to read the guides of the installed package.

For Claude Code, `npx ubq skill` tells the agent to ask you about
a stop hook. If you want it, `npx ubq skill --hook` adds it to
`.claude/settings.json`: `ubq check --hook`, which does nothing
in a project that does not have `ubqtest`. While the last test
results are failures, or are older than the code, or changed lines
ran in no test, the agent cannot end its turn. It gets the report,
with the command for each problem. It can stop on the second try
with the same report, and tell you what it could not do.

The guides are also files of the package: `GUIDE.md` and
`CONVERT.md`.

## Move a project to ubq

```
npx ubq guide convert   # the steps
npx ubq convert test    # the certain changes, and a TODO for each of the others
```

`ubq convert` knows tap, tape, ava, `node:test` with `node:assert`, vitest,
jest, `bun:test`, mocha with `node:assert`, and Playwright Test. It changes imports, test
definitions, and assertions. Where a person or an agent must
decide (subtests, module mocks), it writes a `TODO(ubq)`
comment with the instruction.

## Requirements and limits

- Node 22.18 or later, or Bun 1.4 or later, or Deno. In a CommonJS test file,
  `require('./file')` with no extension needs Node 24.18 or
  later of Node 24, or Node 26.5 or later.
- On Node, TypeScript runs with its types removed and no other
  change. Source with `enum`, `namespace`, parameter
  properties, or decorators does not load on Node. Bun runs it,
  and with the `transform` key a compiler of the project
  (`typescript` or `@swc/core`) makes the JavaScript for Node.
- `.tsx` and `.jsx` files run on Bun and Deno, with coverage.
- Tests of one file run one at a time.
- A test that starts a command or a server as a child process
  gets the coverage of that process, on Node, Bun, or Deno. For a
  Deno child, the test process must be Node.
- Tests of front-end code run in a real browser, with Playwright
  and Chromium: `import { browser } from 'ubqtest/browser'`. The
  project installs `playwright-core`.
- Component tests run with the DOM of jsdom or of happy-dom: the
  `dom` key, on Node and Bun. The project installs the package.
  Node does not run JSX: a `.tsx` test file needs Bun.
- Tests of a Cloudflare Worker run in workerd, with the bindings
  of the wrangler config: the `workers` key, and
  `'ubqtest/workers'`. `exports.default.fetch()` of
  `cloudflare:workers` sends a request to the Worker. The
  project installs `wrangler`.
- Configuration is the `ubq` key of `package.json`: `include`,
  `exclude`, `helpers`, `build`, `timeout`, `browser`, `workers`,
  `define`, `env`, `transform`, `coverage`, and three switches.
  Most projects need none.
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
npm run site         # the web site, in _site/
```

The tests need `bun` and `deno` on the path. A test skips itself
if its runtime is not installed.

## License

[Blue Oak Model License 1.0.0](LICENSE.md)
