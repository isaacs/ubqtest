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
| `timeout` | number | 5000 | The time limit of a test in milliseconds, if the test and its groups set none. |

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

## Not built

- `hangRerun` (D14), because hang reruns are not built.
- A run of all workspaces from the root of a monorepo.
