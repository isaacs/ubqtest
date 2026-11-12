# The background server

`ubq server` starts it. `ubq server stop` stops it. It is optional
(`01-agent-ideation.md`, section 13). Decisions: D36 and D37.

## What it does

1. **It keeps 8 test processes that are started.** Each one ran
   the coverage preload and waits, in a read of stdin, for a test
   file (`src/warm.ts`). A runner that finds the server asks it
   for a process for each test file. With no server, or with no
   process for the request, the runner starts the process itself.
2. **It makes the counters of a file when the file changes.** It
   watches the project folder. For a changed source file it
   writes the cache entry of the counters, with the source with
   no types. The first test process that loads the file after an
   edit then needs no parser, and Node does not load its code
   that removes types.

It does not run tests, it does not keep results, and it loads no
file of the project. A result is never reused (D8).

## Rule: the same result with and without the server

The runner is the same process and the same code in the two
cases. Only the start of a test process differs. So the output,
the exit code, and the store are the same by construction.

A process of the server is equal to a process that the runner
starts, but for these points:

- It gets the environment of the runner after it started. A
  runtime reads some variables only at its start (`NODE_OPTIONS`,
  `TZ`). So the server gives out a process only if the
  environment of the runner is equal to the one that the process
  started with (`_`, `SHLVL`, `PWD`, and `OLDPWD` can differ). If
  not, the runner starts its own process, and the server starts
  new ones with the environment of that runner.
- Its stdin is a pipe at its end, not `/dev/null`.

The server stops, and the runner starts its own processes, if the
runner has a different runtime or a different ubq (`stamp` in
`src/pool.ts`: the path and version of the runtime, and the
newest change time of the files of ubq).

## Parts

| File | Contents |
| --- | --- |
| `src/server.ts` | the `server` command, the server process, the watcher |
| `src/pool.ts` | the socket path, the request, the frames, `warmProcess` for the runner |
| `src/warm.ts` | the program of a process that waits |

The socket is `.ubq/server.sock`, with mode 600. A runner can ask
the server to run any file as the user of the server, so only
that user can connect. Errors of the server go to
`.ubq/server.log`. The state is in the project folder, so two git
worktrees have two servers.

A request is one line of JSON. The answer to `run` is a stream of
frames (one tag character, a length of 4 bytes, the data): `i`
the process ID, `o` stdout, `e` stderr, `p` the events of fd 3,
`x` the exit code and signal, `n` no process. The runner sends
signals to the process itself: it has the process ID, and the
user is the same.

The server stops after 30 minutes with no request and no change
of a file.

## Measured (2026-11-12)

Script: `experiments/server/warm.mjs`, and the benchmark suite.

| Case | No server | Server |
| --- | --- | --- |
| One test process, start to end | 45 ms | 17 ms |
| `ubq` with 3 files | 80 ms | 55 ms |
| `ubq` with 2 files, first run after an edit of a source file | 120 ms | 75 ms |
| `ubq` with 200 files | 850 ms | 850 ms |
| `ubq` with 1 file (runs in the process of the runner) | 51 ms | 51 ms |

A run of many files does not get faster: the server starts a new
process for each one that it gives out, and that start costs the
same in the server as in the runner. The gain is for small runs,
for `--repeat`, and for `ubq mutate`.

## Why no MCP interface, and no HTTP (D37)

The interface for an agent is the `ubq` command and its text.

- Each agent has a shell. An MCP server needs a setup step in
  each agent client, and its tool descriptions use context in
  each session. The command needs no setup, and `ubq guide` costs
  context only when the agent reads it.
- The step 8 check passed with the command and the guide alone,
  on the smallest model, with no wrong call.
- The time of a tool call of an agent is seconds. A command that
  takes 50 ms is not the slow part, so a connection that stays
  open gives an agent nothing.
- What MCP would add is typed arguments. The one argument that is
  hard to write in a shell is a test ID (`'a.test.ts > group >
  name'`). The failure block prints `ubq <file>:<line>` for this
  reason.
- HTTP needs a port. Two worktrees then need two ports, and a
  port is open to each user of the machine. A socket file in
  `.ubq/` has neither problem.

The socket protocol is internal. It can change with each version.

If an MCP interface is wanted later, it is a small adapter: one
tool for each command, which calls the same functions as the CLI
and returns the same text.

## Not built

- The server does not start by itself. A test run that leaves a
  process behind is a surprise, and in CI it is an error.
- No process of the server for a run of one file: that file runs
  in the process of the runner.
- No server on Windows (the socket path, and process groups).
