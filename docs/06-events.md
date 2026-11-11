# Events

The events are the wire format (D4). The exact fields are in
`src/events.ts`, with a comment on each one. That file is the
definition. This document gives the model and the rules.

## 1. Model

A **test process** runs one test file and writes a **file stream**:

```
file-start
  coverage            (code that ran while the file loaded)
  test-start
    output*
  test-end
  coverage            (code that ran in that test)
  ...
  late-failure*
file-end
```

The **runner role** puts the file streams into one **run stream**:

```
run-start
  <file stream> exit
  <file stream> exit
  ...
run-end
```

The runner role is the `ubq` runner when it starts child processes.
In a plain program (`node test/foo.ts`), the test process takes the
runner role for itself. Sinks always read a run stream, so they
have one code path.

Events of different files can mix in a run stream, because files
run in parallel. Events of one file keep their order.

## 2. Events

| Event | Written by | Meaning |
| --- | --- | --- |
| `run-start` | runner role | the command, the runtime, the platform |
| `file-start` | test process | a test file started to load |
| `test-start` | test process | a test started to run |
| `test-end` | test process | status, duration, assertion count, and the failure if there is one |
| `late-failure` | test process | a failure for a test that already ended |
| `output` | test process, runner role | text for stdout or stderr, with the test that wrote it. The runner role writes it for text that did not go through the capture in the test process. |
| `coverage` | test process | ranges that ran since the last `coverage` event of that process. `tfile` names the test file, because events of different files mix in a run stream. |
| `file-error` | test process | a failure that belongs to no test, such as an error while the file loads |
| `file-end` | test process | the file has no more tests |
| `exit` | runner role | exit code and signal of the test process |
| `run-end` | runner role | totals and the exit code of the run |

`hang` (build step 4) is not defined yet.

## 3. Rules

1. **One JSON object for each line.** No line breaks in an object.
2. **`type` names the event.** Field names are full words, so a
   person can read a dump.
3. **The version is on the first event of each stream**
   (`run-start.v`, `file-start.v`), not on each event. The version
   changes only when an event loses a field or a field changes
   meaning. A new optional field does not change it.
4. **A test has exactly one `test-start` and one `test-end`.** A
   skipped test has both. A test that the selection left out has
   none, and `file-end.unselected` counts it.
5. **A passing assertion has no event.** `test-end.asserts` has
   the count. This keeps the stream small.
6. **A test has at most one failure in `test-end`,** because the
   first failed assertion stops the test. A later problem (an
   assertion after the end, an unhandled rejection) is a
   `late-failure`. A consumer must change the status of that test
   to `fail`.
7. **The test process formats values.** `failure.actual`,
   `failure.expected`, and `failure.diff` are text. Values such as
   a `Map` or a class instance do not survive JSON, and the diff
   needs the real values.
8. **Paths are relative to the project root,** with `/`
   separators. The project root is the folder of the nearest
   `package.json` above the working directory.
9. **Stacks hold user frames only.** Frames from the tool, the
   runtime, and `node_modules` are removed in the test process.
10. **A stream that ends with no `file-end` means that the process
    died.** The `exit` event from the runner role has the code and
    the signal.

## 4. Test IDs

`<file> > <group> > <name>`, for example
`test/parse.ts > parse > circle`.

- The separator is ` > `. A test name or a group name that
  contains ` > ` is an error.
- A name must be unique in its group (`05-api.md`, section 3).

## 5. In-process delivery

In a test process, the core library publishes each event on the
`diagnostics_channel` channel `ubq.event`. A sink is a function
that takes one event (`Sink` in `src/events.ts`).

## 6. Example

A file with one passing test and one failing test, as a plain
program:

```json
{"type":"run-start","v":1,"time":1794440000000,"command":["node","test/parse.ts"],"cwd":"/work/app","runtime":{"name":"node","version":"26.5.0"},"platform":"darwin","arch":"arm64","ci":false}
{"type":"file-start","v":1,"file":"test/parse.ts","pid":4242,"coverage":"partial"}
{"type":"test-start","id":"test/parse.ts > parse > circle","timeout":5000,"at":{"file":"test/parse.ts","line":5,"column":3}}
{"type":"test-end","id":"test/parse.ts > parse > circle","status":"pass","ms":0.21,"asserts":3}
{"type":"test-start","id":"test/parse.ts > parse > square","timeout":5000,"at":{"file":"test/parse.ts","line":12,"column":3}}
{"type":"test-end","id":"test/parse.ts > parse > square","status":"fail","ms":0.4,"asserts":1,"failure":{"kind":"assert","assertion":"equal","message":"expected values to be equal","at":{"file":"test/parse.ts","line":14,"column":12},"actual":"3","expected":"2","diff":"- 2\n+ 3"}}
{"type":"file-end","file":"test/parse.ts","unselected":0}
{"type":"exit","file":"test/parse.ts","code":1,"signal":null}
{"type":"run-end","ms":41.2,"pass":1,"fail":1,"errors":0,"skip":0,"unselected":0,"code":1}
```
