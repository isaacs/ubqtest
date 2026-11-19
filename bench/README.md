# The benchmark of test tools

The same 20 test files, for ubq, vitest, ava, tape, and mocha, in
a Docker container with a fixed budget of CPU and memory.
It answers one question: how long does a project wait for its
tests, and how much CPU does it pay for, with each tool?

```
bench/docker.sh                          2 CPUs, 2 GB of memory, 10 runs of each command
bench/docker.sh --cpus 4 --memory 4g
bench/docker.sh --runs 3 --only vitest   options of run.ts
bench/docker.sh --json > result.json
```

The command builds ubq, builds the image, and runs it. It needs
Docker.

## The suite

`gen.ts` writes the test files. `src/` is the code under test:
14 small TypeScript modules. Each tool gets the same 20 files, 306
tests, and 2330 assertions, in the form that a project with that
tool has.

| Files | What they do |
| --- | --- |
| 9 | Plain assertions on functions and a class: equal, deep equal, a thrown error, a RegExp. |
| 3 | Async code with real timers of 1 to 30 ms: retry, a limit on calls at the same time, a time limit. |
| 2 | Spies: the count of calls, and the arguments of a call. |
| 2 | Module mocks: a module with a dependency that the test replaces. |
| 1 | A fake clock: `debounce`, and `setInterval`. |
| 1 | Snapshots: 12 text reports. |
| 1 | A folder of files that the test makes, reads, and writes. |
| 1 | A child process: the test starts `node` 6 times. |

Where a tool has no function of its own, the test uses what a
project with that tool uses:

- **Spies and the clock:** ubq and vitest have their own. ava,
  tape, and mocha use sinon.
- **Module mocks:** `mockImport` of ubq, `vi.doMock` of vitest,
  and esmock for ava, tape, and mocha.
- **Snapshots:** ubq, vitest, and ava have them. For tape and
  mocha, the expected text is in the test file.
- **A folder of files:** `testdir` of ubq. The other files make a
  folder in the temp folder, and remove it.
- **TypeScript:** Node runs the files with their types removed,
  for each tool but vitest, which changes them with its own
  compiler.

## The commands

Each row is the command that a project has in its `test`
script, with `CI=1`. The command runs one time with no
measurement, then 10 times. A command that fails has no result.
The table has the median. "CPU s" is the CPU time of the command
and of each process that it starts: on a CI machine, this is the
cost. "MB" is the most memory of one process.

- **ubq** records coverage in each run, so its row in the second
  table is the same command.
- **ubq, with the type check** is the same project with a
  `tsconfig.json`: ubq then runs the type checker of the
  project at the same time as the tests.
- **ubq, with no state of a run before** removes the `.ubq`
  folder before each run: the store, and the cache of the source
  with counters. A job in CI starts this way, if it keeps no
  cache.
- **vitest, no isolation** and **mocha, parallel** are options
  that a project can set. They are not the defaults.
- **tape** has no command for these files: its command cannot
  load a module that waits at its top level, as esmock does. A
  short program imports each test file in one process.

## Results

The full results, with the least and the most of each command,
are in `results/`. `node tables.ts` writes the tables from them.

<!-- results -->
Node v24.22.3. ubqtest 0.0.19, vitest 5.1.1, ava 8.4.0, tape 5.11.0, mocha 12.0.3, c8 12.0.0.

### All 20 files

| Command | 2 CPUs, 2 GB: wall s | CPU s | MB | 4 CPUs, 4 GB: wall s | CPU s | MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ubq | 0.74 | 1.32 | 68 | 0.48 | 1.28 | 67 |
| ubq, with no state of a run before | 0.97 | 1.71 | 125 | 0.71 | 1.73 | 115 |
| ubq, with the type check | 0.79 | 1.40 | 83 | 0.48 | 1.45 | 85 |
| vitest | 2.13 | 2.36 | 134 | 0.91 | 2.45 | 134 |
| vitest, no isolation | 0.90 | 0.85 | 130 | 0.59 | 1.06 | 131 |
| ava | 1.56 | 2.81 | 175 | 1.23 | 2.96 | 175 |
| tape | 0.86 | 0.85 | 139 | 0.87 | 0.89 | 137 |
| mocha | 0.76 | 0.72 | 119 | 0.76 | 0.76 | 120 |
| mocha, parallel | 0.80 | 1.27 | 100 | 0.59 | 1.32 | 100 |

### All 20 files, with coverage

| Command | 2 CPUs, 2 GB: wall s | CPU s | MB | 4 CPUs, 4 GB: wall s | CPU s | MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ubq | 0.68 | 1.23 | 67 | 0.49 | 1.28 | 68 |
| vitest | 2.50 | 2.77 | 153 | 1.09 | 2.90 | 155 |
| ava with c8 | 2.02 | 3.57 | 185 | 1.64 | 3.71 | 188 |
| tape with c8 | 1.08 | 1.16 | 142 | 1.08 | 1.21 | 141 |
| mocha with c8 | 0.94 | 1.00 | 124 | 0.93 | 1.04 | 121 |

### One file (21 tests, 210 plain assertions)

| Command | 2 CPUs, 2 GB: wall s | CPU s | MB | 4 CPUs, 4 GB: wall s | CPU s | MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ubq | 0.06 | 0.07 | 69 | 0.06 | 0.07 | 69 |
| ubq, the file as a program | 0.12 | 0.14 | 98 | 0.10 | 0.16 | 100 |
| vitest | 0.25 | 0.29 | 126 | 0.24 | 0.30 | 126 |
| ava | 0.21 | 0.25 | 117 | 0.20 | 0.26 | 118 |
| tape | 0.11 | 0.13 | 85 | 0.09 | 0.13 | 86 |
| mocha | 0.12 | 0.14 | 90 | 0.11 | 0.14 | 91 |
<!-- /results -->

## What the results say about ubq

- **Wall time.** ubq is the fastest with 4 CPUs (0.48 s), and
  level with mocha with 2 CPUs (0.74 s and 0.76 s). mocha runs
  each file in one process, with no isolation and no coverage.
  With coverage for each tool, ubq is the fastest in the two
  budgets.
- **CPU time.** ubq uses about 1.3 s of CPU. mocha, tape, and
  vitest with no isolation use 0.7 to 0.9 s: they load Node and
  each module one time, for all files. ubq starts a process for
  each test file. Of the tools that give each file its own
  process or thread, ubq uses the least: vitest uses 2.3 to 2.5
  s, and ava 2.8 to 2.9 s.
- **A run with no state**, as a job in CI, takes 0.97 s with 2
  CPUs, and 1.71 s of CPU.
- **One file.** `ubq <file>` takes 0.06 s. No other tool is
  below 0.09 s.

## The first changes that this benchmark led to

The numbers before are in `results/baseline/`: the same
benchmark, with ubq at commit 66b9cf7.

| ubq, all 20 files | 2 CPUs: wall s | CPU s | 4 CPUs: wall s | CPU s |
| --- | ---: | ---: | ---: | ---: |
| before | 0.86 | 1.45 | 0.56 | 1.44 |
| after | 0.78 | 1.27 | 0.47 | 1.28 |
| before, with no state of a run before | 1.79 | 3.31 | 1.02 | 3.35 |
| after, with no state of a run before | 1.00 | 1.66 | 0.70 | 1.73 |

Two causes, and their changes:

- **Each test process made the same cache entries.** ubq keeps
  the source of each file with its counters in `.ubq/counters/`.
  With no cache, each of the 20 test processes loaded the parser
  and changed the same files. Now the runner makes the entries of
  the test files, and of the project files that they import, one
  time, before it starts a test process. It does this only if the
  project has no such folder.
- **Node removed the types of each file in each process.** The
  cache entry of a TypeScript file now also has the source with
  its types removed, so a test process loads JavaScript.

What a test process costs, with a cache, on the machine of the
maintainer (Node 26): `node -e 0` takes 30 ms, and a test process
of a small file takes 47 ms. Of the 17 ms between them, 5 ms is
the preload of ubq, which is almost all the time of Node to load
its own modules (`fs`, `crypto`, `child_process`), 2 ms is the
library, and the rest is the test file and its report. A change
that loaded those modules of Node in a different way gave no
gain, and is not in the code.

After these changes, a profile found no other large cost in the
code of ubq. In the container with 2 CPUs, for the 20 files:

| Where the 1.25 s of CPU goes, about | ms |
| --- | ---: |
| Node starts 20 times (21 ms each) | 420 |
| The 6 processes that the tests of one file start | 260 |
| The runner process | 200 |
| The 20 test processes, after the start of Node | 370 |

Tried, measured, and not in the code:

- **Modules of Node at their first use.** A test process of ubq
  made Node load 107 modules that a program with no imports does
  not: `crypto`, streams, `child_process`, `perf_hooks`, and
  others. A build that loaded each of them at its first use took
  that to 4 modules. The gain was 1.4 ms of 45 ms for a test
  process, and 2% of the CPU time of the suite.
- **The compile cache of Node.** A run with no compile cache
  takes the same time as a run with one.

What stays in a run with no state is the work that the runner
does one time: 160 ms to add counters to 34 files and to remove
their types. A job in CI that keeps `.ubq/counters` does not do
it: the guide has the cache step for GitHub Actions.

The largest cost that stays is the start of Node for each test
file. That is the design (D9, D34): a file cannot change a second
file, and a file that hangs stops only itself.

The runner starts one more test process at the same time than
the machine has CPUs (D107): a test that waits uses no CPU. With
2 CPUs, the 20 files went from 0.78 s to 0.74 s in the full
benchmark.
