# Configuration

The goal is as little configuration as possible (D24). Most
projects need none.

## What ubq runs with no configuration

`ubq` with no arguments runs each file in the project whose name
ends in `.test.ts`, `.test.mts`, `.test.cts`, `.test.tsx`,
`.test.js`, `.test.mjs`, `.test.cjs`, or `.test.jsx` (D19).

The project is the folder of the nearest `package.json` at or
above the working directory. The search leaves out:

- `node_modules`
- folders whose names start with a dot
- folders that have their own `package.json` (D23). Such a folder
  is a different project, with its own run store. Examples: a
  package of a monorepo, a folder of experiments, a fixture
  project.

A file that is an argument always runs: `ubq any/file.ts`. A
folder that is an argument runs the test files of the project
that are in it. A folder that is a different project is an error.

## The `ubq` key of `package.json`

```json
{
  "ubq": {
    "include": ["test/**/*.ts"],
    "exclude": ["test/helpers/**"],
    "timeout": 10000
  }
}
```

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `include` | list of glob patterns | the `.test.` name pattern | Replaces the name pattern. Paths are from the project root. |
| `exclude` | list of glob patterns | none | Files that are not test files, after `include`. |
| `helpers` | list of glob patterns | `**/{test,tests,__tests__}/**` | Test helpers: files that are part of the tests and are not test files, such as a setup module or the scenario of an end-to-end test (D51). `ubq uncovered` leaves them out, and `ubq mutate --diff` does not change them. The list replaces the default. An empty list means that no file is a helper. |
| `timeout` | number | 5000 | The time limit of a test in milliseconds, if the test and its groups set none. |
| `hangRerun` | boolean | true | `false` turns off the rerun of a test that timed out with something open (D14). |
| `bunInspectorCoverage` | boolean | false | `true` records coverage for a test file that runs as a plain program on Bun (`bun test/foo.ts`). The places are a guess and can be wrong (D39). |
| `browser` | object | none | For tests that use `'ubqtest/browser'` (D45). `url`: the base of `page.goto('/path')`. `command` (optional): the shell command that starts the server at `url`. `ubq` runs it from the project root if a test file of the run imports `'ubqtest/browser'` and nothing answers at `url`, waits 30 seconds at most for an answer, and stops it after the run. Its output is in `.ubq/browser-server.log`. With no `browser` key, a page loads the files of the project from the disk. |
| `workers` | list of objects | none | Test files that run in workerd, the runtime of Cloudflare Workers (D48). Each object has `config` (the path of a wrangler config, from the project root) and `include` (glob patterns of test files, from the project root). `vars` (optional) is an object of test values for vars: they go on top of the `vars` of the wrangler config. The values of `.dev.vars` and `.env` are not read. A test file that matches gets the bindings of that config. A file must also be a test file by `include` and `exclude` of the first rows. The first object that matches a file wins. The project must have the `wrangler` package. |

Rules:

- A key that is not in the table is an error (exit code 4). The
  message lists the keys.
- A value of the wrong type is an error (exit code 4). The message
  gives an example of a correct value.
- The three always-left-out folders above stay left out with
  `include`.
- Patterns have no `!` negation. Use `exclude`.
- There is no config file and no config module. JSON has no
  logic, each tool can read it, and ubq reads `package.json` in
  any case.

Source: `src/config.ts`. Tests: `test/select.test.ts`.

## A monorepo

At a project root that has `workspaces` in its `package.json` and
no test files of its own, `ubq` runs the command in each
workspace, one after the other (`ubq`, `ubq --failed`, `ubq
--changed`). Each workspace is a project with its own store, and
the paths in its report are from its own folder. The last line
is `workspaces: 3 passed`, or `workspaces: 1 of 3 failed:
packages/b`. A workspace with no tests does not count.

For a question about stored runs, or for one test, run `ubq` in
the folder of the workspace.
