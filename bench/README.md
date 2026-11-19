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
- **vitest, no isolation** and **mocha, parallel** are options
  that a project can set. They are not the defaults.
- **tape** has no command for these files: its command cannot
  load a module that waits at its top level, as esmock does. A
  short program imports each test file in one process.

## Results

Node v24.22.3, on 2026-11-19. ubqtest 0.0.19, vitest 5.1.1, ava 8.4.0,
tape 5.11.0, mocha 12.0.3, c8 12.0.0. The full results, with the
least and the most of each command, are in `results/`.

### All 20 files

| Command | 2 CPUs: wall s | CPU s | MB | 4 CPUs: wall s | CPU s | MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ubq | 0.81 | 1.34 | 73 | 0.57 | 1.54 | 74 |
| ubq, with the type check | 0.90 | 1.52 | 84 | 0.60 | 1.63 | 85 |
| vitest | 2.13 | 2.34 | 134 | 0.92 | 2.44 | 133 |
| vitest, no isolation | 0.91 | 0.85 | 131 | 0.59 | 1.06 | 132 |
| ava | 1.58 | 2.83 | 173 | 1.21 | 2.92 | 171 |
| mocha | 0.79 | 0.74 | 118 | 0.75 | 0.76 | 121 |
| mocha, parallel | 0.77 | 1.27 | 101 | 0.60 | 1.31 | 100 |

### All 20 files, with coverage

| Command | 2 CPUs: wall s | CPU s | MB | 4 CPUs: wall s | CPU s | MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ubq | 0.85 | 1.40 | 73 | 0.58 | 1.48 | 72 |
| vitest | 2.51 | 2.77 | 153 | 1.09 | 2.90 | 154 |
| ava with c8 | 2.01 | 3.56 | 186 | 1.64 | 3.72 | 186 |
| mocha with c8 | 0.99 | 1.01 | 123 | 0.93 | 1.04 | 121 |

### One file (21 tests, 210 plain assertions)

| Command | 2 CPUs: wall s | CPU s | MB | 4 CPUs: wall s | CPU s | MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ubq | 0.06 | 0.06 | 69 | 0.06 | 0.06 | 69 |
| ubq, the file as a program | 0.12 | 0.15 | 98 | 0.11 | 0.15 | 99 |
| vitest | 0.25 | 0.28 | 126 | 0.24 | 0.29 | 126 |
| ava | 0.21 | 0.25 | 117 | 0.19 | 0.26 | 118 |
| mocha | 0.12 | 0.13 | 89 | 0.11 | 0.14 | 91 |

## What the results say about ubq

- **Wall time.** With 4 CPUs, ubq is the fastest (0.57 s). With 2
  CPUs it is level with mocha (0.81 s and 0.79 s), and mocha runs
  each file in one process with no isolation and no coverage.
  With coverage, ubq is the fastest in the two budgets.
- **CPU time.** ubq uses 1.3 to 1.5 s of CPU, and mocha, tape,
  and vitest with no isolation use 0.7 to 0.9 s. A process for
  each test file is the cost. This is what a CI machine bills.
- **One file.** `ubq <file>` takes 0.06 s. No other tool is
  below 0.09 s.

Where the time of ubq goes, from single commands in the same
container (2 CPUs):

| Command | ms |
| --- | ---: |
| `node -e 0` | 20 |
| `node -e "import('ubqtest')"` | 53 |
| `node test/text-slug.test.ts` (the file as a program) | 114 |
| `ubq test/text-slug.test.ts` | 63 |
| `ubq test/child.test.ts` (its 6 tests take 257 ms) | 473 |
| `ubq` (all 20 files) | 825 |

Three things to look at:

1. **The library takes 33 ms to load**, in each test process. The
   20 files of this suite pay about 0.65 s of CPU for it.
2. **A test file as a plain program takes 114 ms**, and the same
   file with `ubq <file>` takes 63 ms.
3. **The file that starts child processes takes 473 ms**, with
   257 ms in its tests. This one file is more than half of the
   wall time of the suite. ubq records the coverage of each
   child process, which the other tools do not do.
