# The store

Each run writes its results to `.ubq/runs.db`, a SQLite file in
the project root. The commands `ubq failures`, `ubq show`, `ubq
history`, `ubq diff`, `ubq slow`, `ubq uncovered`, and `ubq
covers` read it. For a question that these commands do not
answer, `ubq sql` runs a SQL query on the store:

```
ubq sql "select id, ms from test \
  where run = (select max(id) from run) \
  order by ms desc limit 5"
```

- The query cannot change the store (`pragma query_only`).
- Each row prints as one line of JSON.
- The store has its rows while a run goes on. A query during a
  run sees the results up to that time.
- A new version of ubq can change the tables. If the version of
  the tables changes, ubq removes the old store and starts a new
  one.

## Tables

A run keeps the rows of the last 50 runs in `run`, `test`,
`file_error`, `type_error`, and `output`. The coverage tables keep the last
coverage of each test, from any run.

Some columns hold JSON as text. Use the SQLite function
`json_extract` to read a field of it.

### `run`

One row for each run.

| Column | Type | Value |
| --- | --- | --- |
| `id` | integer | The number of the run, as in `pass: ... (run 7)`. |
| `time` | integer | The start, in milliseconds since 1970. |
| `command` | text | JSON array of the command line, such as `["ubq","--changed"]`. |
| `cwd` | text | The working directory. |
| `runtime` | text | The runtime and its version, such as `node 26.5.0`. |
| `platform` | text | The system and the CPU, such as `darwin arm64`. |
| `ci` | integer | 1 if `CI` was set, else 0. |
| `commit_hash` | text | The git commit at the start, or null. |
| `seed` | integer | The seed of the order of the files. |
| `env` | text | JSON object of the variables that can change a result and that were set: `NODE_OPTIONS`, `NODE_ENV`, `TZ`, `LANG`, `LC_ALL`, `UBQ_COVERAGE`, `UBQ_BROWSER`. |
| `ms` | real | The duration. Null until the run ends. |
| `pass`, `fail`, `errors`, `skip`, `unselected` | integer | The counts of the summary line. Null until the run ends. |
| `code` | integer | The exit code. Null until the run ends, or if the run stopped. |

### `test`

One row for each test in each run.

| Column | Type | Value |
| --- | --- | --- |
| `run` | integer | The `id` of the run. |
| `id` | text | The test ID: `test/parse.test.ts > parse > circle`. |
| `file` | text | The test file. |
| `line` | integer | The line of the `test()` call. |
| `status` | text | `pass`, `fail`, or `skip`. |
| `ms` | real | The duration. |
| `asserts` | integer | The count of assertions that ran. |
| `reason` | text | The reason of a skip, or null. |
| `failure` | text | JSON of the failure, or null. See [Failures](#failures). |
| `code` | text | A digest of the content of each file that the test ran. Two runs with the same digest ran the same code. Null with no coverage. |
| `repeats`, `fails` | integer | With `--repeat`: how many times the test ran, and how many times it failed. Else null. |

### `file_error`

One row for each error of a test file that is not a failure of a
test: a syntax error, a missing import, an exit before the end, a
file with no tests, or a stop by `--max-time`.

| Column | Type | Value |
| --- | --- | --- |
| `run` | integer | The `id` of the run. |
| `file` | text | The test file. |
| `failure` | text | JSON of the failure. See [Failures](#failures). |

### `type_error`

One row for each error of the type checker.

| Column | Type | Value |
| --- | --- | --- |
| `run` | integer | The `id` of the run. |
| `error` | text | JSON with `code` (such as `TS2322`), `message`, and `at` (`file`, `line`, `column`), if the error has a place. |

### `output`

The console output of the tests.

| Column | Type | Value |
| --- | --- | --- |
| `run` | integer | The `id` of the run. |
| `file` | text | The test file. |
| `test` | text | The test ID, or null for output outside a test. |
| `stream` | text | `stdout` or `stderr`. |
| `text` | text | The output. |

### `coverage`

The last coverage of each test, for each file that it ran. `ubq
uncovered`, `ubq covers`, and `ubq --changed` read it.

| Column | Type | Value |
| --- | --- | --- |
| `tfile` | text | The test file. |
| `test` | text | The test ID, or `''` for code that ran while the file loaded. |
| `file` | text | The file that the test ran. |
| `run` | integer | The run that wrote the row. |
| `ranges` | text | JSON array of numbers, in groups of three: start, end, count. Start and end are character offsets in the file. A count of 0 is code that did not run. |
| `hash` | text | The content hash of `file` at the time of the run. |

### `other_coverage`

Coverage from a different runtime or system, such as a run on Bun,
or a store that `ubq merge` read. `ubq uncovered` and `ubq covers`
read it if `hash` is the hash of the file as it is now.

| Column | Type | Value |
| --- | --- | --- |
| `env` | text | The runtime and the system, such as `bun-darwin`. |
| `tfile`, `test`, `file`, `ranges`, `hash` | | As in `coverage`. |

### `test_file`

One row for each test file, from its last run.

| Column | Type | Value |
| --- | --- | --- |
| `tfile` | text | The test file. |
| `run` | integer | The last run of the file. |
| `coverage` | text | `full`: coverage started before the file loaded. `partial`: it started later, so functions that never ran, and the top-level code of modules, are not known. `none`: the runtime has no coverage. |
| `hash` | text | The content hash of the test file. |

## Failures

The `failure` columns hold JSON with these fields:

| Field | Value |
| --- | --- |
| `kind` | `assert`, `error`, `timeout`, `no-assertions`, `not-awaited`, `cleanup`, `late`, `never-settled`, `leak`, or `no-tests`. |
| `message` | One line that tells what went wrong. |
| `at` | The place in the code of the test: `file`, `line`, `column`. |
| `stack` | The places in user code, the innermost first. |
| `assertion` | For `assert`: the function, such as `equal`. |
| `actual`, `expected`, `diff` | For `assert`: the two values and the difference, as text. |
| `pending` | For `timeout`: what kept the test open, such as `Timeout x2`. |
| `opened` | For `timeout`, after a rerun: the places that opened what is in `pending`. |

## Examples

The failures of the last run, with their messages:

```
ubq sql " \
  select id, json_extract(failure, '$.message') as message \
  from test \
  where run = (select max(id) from run) and status = 'fail'"
```

The tests that passed in some runs and failed in others:

```
ubq sql "select id \
  from test \
  group by id \
  having sum(status = 'fail') > 0 and sum(status = 'pass') > 0"
```

The slowest tests, from the mean of each stored run:

```
ubq sql "select id, round(avg(ms), 1) as ms \
  from test where status = 'pass' \
  group by id \
  order by avg(ms) desc \
  limit 10"
```

The tests with a status that changed since the run before:

```
ubq sql "select a.id, a.status as before, b.status as now \
  from test a join test b on b.id = a.id and b.run = a.run + 1 \
  where b.run = (select max(id) from run) and a.status != b.status"
```

The count of each kind of failure:

```
ubq sql "select json_extract(failure, '$.kind') as kind, \
  count(*) as n \
  from test \
  where failure is not null \
  group by kind \
  order by n desc"
```

The test files that ran code of a file:

```
ubq sql "select distinct tfile \
  from coverage \
  where file = 'src/parse.ts'"
```

The tests of the last run with the fewest assertions:

```
ubq sql "select id, asserts \
  from test \
  where run = (select max(id) from run) \
  order by asserts \
  limit 10"
```

The type errors of the last run:

```
ubq sql " \
  select \
    json_extract(error, '$.code') as code, \
    json_extract(error, '$.at.file') as file, \
    json_extract(error, '$.message') as message \
  from type_error \
  where run = (select max(id) from run)"
```

The exit code and the environment of the last runs:

```
ubq sql "select id, code, pass, fail, env \
  from run order by id desc limit 5"
```
