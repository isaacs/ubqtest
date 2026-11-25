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
- with no `include` key, the `dist` folder of the root (D113). A
  build of the test files there is a second copy of each test.

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
| `helpers` | list of glob patterns | `**/{test,tests,__tests__}/**` | Test helpers: files that are part of the tests and are not test files, such as a setup module or the scenario of an end-to-end test (D51). `ubq uncovered` leaves them out, and `ubq mutate --diff` does not change them. The list replaces the default. An empty list means that no file is a helper. A test file is never a helper: `include` and `exclude` choose the test files, and this key is for the other files that the tests load. `ubq uncovered` names the helpers that it leaves out. |
| `build` | list of glob patterns | `dist/**`, `scripts/**`, `**/*.config.{ts,js,mts,mjs,cts,cjs}` | Files that are not source of the program: the output of a build, and the tools of the build (D55). `ubq uncovered` leaves them out, and `ubq mutate --diff` does not change them. The list replaces the default. An empty list means that each file is source. A built file with a source map gives its coverage to the source files that the map names. |
| `timeout` | number | 5000 | The time limit of a test in milliseconds, if the test and its groups set none. |
| `hangRerun` | boolean | true | `false` turns off the rerun of a test that timed out with something open (D14). |
| `bunInspectorCoverage` | boolean | false | `true` records coverage for a test file that runs as a plain program on Bun (`bun test/foo.ts`). The places are a guess and can be wrong (D39). |
| `browser` | object | none | For tests that use `'ubqtest/browser'` (D45). `url`: the base of `page.goto('/path')`. `command` (optional): the shell command that starts the server at `url`. `ubq` runs it from the project root if a test file of the run imports `'ubqtest/browser'` and nothing answers at `url`, waits 30 seconds at most for an answer, and stops it after the run. Its output is in `.ubq/browser-server.log`. With no `browser` key, a page loads the files of the project from the disk. |
| `workers` | list of objects | none | Test files that run in workerd, the runtime of Cloudflare Workers (D48). Each object has `config` (required: the path of a wrangler config, from the project root) and `include` (required: glob patterns of test files, from the project root). `vars` (optional) is an object of test values for vars: they go on top of the `vars` of the wrangler config. The values of `.dev.vars` and `.env` are not read. A test file that matches gets the bindings of that config. A file must also be a test file by the `include` and `exclude` keys of this table. The first object that matches a file wins. The project must have the `wrangler` package. |
| `define` | object | none | Global values that the source reads, as the `define` of vite gives them (D83). Each key is a global name, and each value is a JSON value: `{ "__DEBUG_BUILD__": true }`. A test process of Node, Bun, or Deno sets each one on `globalThis` before the test file loads. A test file that runs as a plain program sets them when it loads `ubqtest`, so it must import `ubqtest` before the source. ubq does not put the value in place of the name in the source, as vite does: `typeof` of the name differs, and code in an `if (__DEBUG_BUILD__)` block stays. `ubq convert` writes the key from a vite or vitest config. |
| `transform` | `"typescript"` or `"swc"` | none | The compiler for source that Node cannot run with only its types removed: a decorator, an `enum`, a parameter property (D111), and the JSX of a `.tsx` or `.jsx` file (D145). The `typescript` package (version 5 or 6) or the `@swc/core` package of the project makes the JavaScript of each TypeScript file and each JSX file of the project, with the options of the `tsconfig.ubq.json` or `tsconfig.json` of the folder of the file. The JavaScript is in the cache of `.ubq/counters/`, so a file is compiled one time for each change. `ubq convert --transform=<name>` sets the key. Bun and Deno do not read it. |
| `env` | object | none | Values of the environment for each test process, as `test.env` of vitest gives them (D114): `{ "MODE": "dev" }`. Each value is text. A test process sets them before the test file loads, and a test file that runs as a plain program sets them when it loads `ubqtest`. A value of the key is before a value of the shell with the same name, so a test has the same result on each machine. `NODE_OPTIONS` is different (D132): ubq adds the value of the key to the value of the shell, and the runner starts each test process with it. A Bun test process gets each export condition of the value (`--conditions=x`, `-C x`) in `BUN_OPTIONS`, and a Deno test process in `DENO_CONDITIONS` (D137). A test file that runs as a plain program does not get it: the process started before ubq read the key. `ubq convert` writes the key from a vitest config. |
| `coverage` | `"full"` | none | A run of all tests fails if code ran in no test (D130): the ranges that `ubq uncovered` lists, with no test helper, no build file, and no range with a `ubq: not measured:` comment. The summary has the count, and the exit code is 1. The output lists the ranges if there are fewer than 5. A longer list is only in `ubq uncovered`. A run of some tests (files, test IDs, `--failed`, `--changed`) does not check. `UBQ_COVERAGE_CHECK=0` in the environment turns the check off for one run, and `1` or an empty value keeps the config. A different value of that variable is an error (exit code 4). It is the full coverage of tap. |
| `dom` | object | none | The DOM of test files, as `environment` of vitest gives it (D144). `package` (required): `"jsdom"` or `"happy-dom"`, a package of the project. `include` (optional): glob patterns of the test files that get the DOM, from the project root. With none, each test file gets it. `url` (optional): the address of the page. The default is `http://localhost:3000/`. A test process of Node or Bun makes the DOM before the test file loads, and puts each name of the window on `globalThis`. A name that the runtime has stays, but for the names that an element needs from its own window, such as `Event` and `AbortController`. In such a file the four hooks are also globals: Testing Library gives its cleanup to a global `afterEach`. Not on Deno, and not for a file of the `workers` key. `ubq guide dom` has the rules. |
| `skipTypecheck` | boolean | `false` | `true`: a run does not check the types (D114). The project runs its type checker as a separate step. It is a key and not an option of the command: it is a rule of the project, and a project would put the option in its `test` script. |

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
workspace (`ubq`, `ubq --failed`, `ubq --changed`). The workspaces
run at the same time (D140). Their test files share the slots of
one run: the count of the CPUs, plus one. A type checker holds a
slot too. The output of each workspace is in the order of the list:
the first workspace that has not ended prints as it runs, and the
others wait. Each workspace is a project with its own store, and
the paths in its report are from its own folder. The last line
is `workspaces: 3 passed`, or `workspaces: 1 of 3 failed:
packages/b`. A workspace with no tests does not count.

For a question about stored runs, or for one test, run `ubq` in
the folder of the workspace.
