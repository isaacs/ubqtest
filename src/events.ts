// The event definitions. This file is the wire format: a test process
// writes these objects as JSON lines, and each sink reads them.
// See docs/06-events.md for the rules.

/** Changes when an event loses a field or a field changes meaning. */
export const EVENT_VERSION = 1

/** `test/parse.ts > parse > circle` */
export type TestId = string

/** A position in a source file. Lines and columns start at 1. */
export interface Location {
  /** Path from the project root, with `/` separators. */
  file: string
  line: number
  column: number
}

export type FailureKind =
  | 'assert' // an assertion failed
  | 'error' // the test threw something that is not an assertion failure
  | 'timeout' // the test ran longer than its limit
  | 'no-assertions' // the test ended and no assertion ran
  | 'not-awaited' // the result of assert.rejects was not awaited
  | 'cleanup' // a cleanup function threw
  | 'late' // an assertion or an error came after the test ended
  | 'never-settled' // the process was about to exit while the test was open
  | 'leak' // the test changed the process and did not put the change back
  | 'no-tests' // the file registered no tests

export interface Failure {
  kind: FailureKind
  /** One line that states what went wrong. */
  message: string
  /** Where the failure is in user code. Absent if no user frame exists. */
  at?: Location
  /** Stack frames in user code only, innermost first. */
  stack?: Location[]
  /** For `assert`: the assertion function, such as `equal`. */
  assertion?: string
  /** For `assert`: the two values as text, each with a size limit. */
  actual?: string
  expected?: string
  /** For `assert`: the differences, each with the path to it. */
  diff?: string
  /**
   * For `timeout` and for a process that does not exit: what keeps
   * the process alive, such as `Timeout x2` or `TCPServerWrap`.
   */
  pending?: string[]
  /** For `timeout`, after a hang rerun: the places that opened what is in `pending`. */
  opened?: Opened[]
}

/** A resource that a test opened, and the user code that opened it. */
export interface Opened {
  /** `TCPServerWrap`, `Timeout` */
  type: string
  at: Location
}

/** First event of a run. The runner role writes it. */
export interface RunStart {
  type: 'run-start'
  v: typeof EVENT_VERSION
  /** The number of the run in the store. Absent if the run is not stored. */
  run?: number
  /** Epoch milliseconds. */
  time: number
  command: string[]
  cwd: string
  runtime: { name: 'node' | 'deno' | 'bun'; version: string }
  platform: string
  arch: string
  ci: boolean
  /** The git commit that is checked out. Absent if the project is not in git. */
  commit?: string
  /** The seed of the order of the test files. Absent in a run of one file. */
  seed?: number
}

/** First event from a test process. */
export interface FileStart {
  type: 'file-start'
  v: typeof EVENT_VERSION
  file: string
  pid: number
  /**
   * `full`: coverage started before the file loaded.
   * `partial`: coverage started after the file loaded. Functions
   * that never ran, and top-level code of modules, are not known.
   * `none`: the runtime has no collector.
   */
  coverage: 'full' | 'partial' | 'none'
}

export interface TestStart {
  type: 'test-start'
  id: TestId
  /** The time limit of the test, in milliseconds. */
  timeout: number
  /** The `test()` call. */
  at?: Location
}

export interface TestEnd {
  type: 'test-end'
  id: TestId
  status: 'pass' | 'fail' | 'skip'
  /** Milliseconds. 0 for a skipped test. */
  ms: number
  /** Count of assertions that ran. */
  asserts: number
  /** For `fail`. */
  failure?: Failure
  /** For `skip`: the reason from the test options. */
  reason?: string
  /** `testdir` folders that stay because the test failed. */
  kept?: string[]
  /**
   * For `ubq --repeat`: how often the test ran and how often it
   * failed. The other fields are from the first failure, or from the
   * last time if the test did not fail.
   */
  repeat?: Repeat
}

export interface Repeat {
  runs: number
  fails: number
}

/** A failure that came after the `test-end` of its test. */
export interface LateFailure {
  type: 'late-failure'
  id: TestId
  failure: Failure
}

/** Text that the code wrote to stdout or stderr. */
export interface Output {
  type: 'output'
  /** The file whose process wrote the text. */
  file: string
  /** Absent for text written outside a test. */
  id?: TestId
  stream: 'stdout' | 'stderr'
  text: string
}

/** Code that ran since the last coverage event of this process. */
export interface Coverage {
  type: 'coverage'
  /** The test file whose process ran the code. */
  tfile: string
  /** Absent for code that ran while the file loaded. */
  id?: TestId
  files: {
    file: string
    /**
     * Flat triples: start offset, end offset, count. The segments do
     * not overlap. A count of 0 marks code that did not run in a
     * function that did, or a function that never ran.
     */
    ranges: number[]
  }[]
}

/** A failure that belongs to no test, such as an error while the file loads. */
export interface FileError {
  type: 'file-error'
  file: string
  failure: Failure
  /** For `ubq --repeat`: in how many of the repeats the file had an error. */
  repeat?: Repeat
}

/** Last event from a test process. */
export interface FileEnd {
  type: 'file-end'
  file: string
  /** Tests that the selection left out. */
  unselected: number
  /** With `ubq --update`: the count of snapshots that are new or changed. */
  updated?: number
}

/** The test process exited. The runner role writes it. */
export interface Exit {
  type: 'exit'
  file: string
  code: number | null
  signal: string | null
}

/**
 * An error from the type checker of the project. The runner role
 * writes it, after the events of the test files.
 */
export interface TypeCheckError {
  type: 'type-error'
  /** `TS2322` */
  code: string
  message: string
  /** Absent for an error that belongs to no file. */
  at?: Location
}

/**
 * The result of a hang rerun (D14): what a test that timed out left
 * open, with the places that opened it. The runner role writes it,
 * after the events of the test files.
 */
export interface Hang {
  type: 'hang'
  id: TestId
  opened: Opened[]
}

/** Last event of a run. The runner role writes it. */
export interface RunEnd {
  type: 'run-end'
  ms: number
  pass: number
  fail: number
  /** Count of `file-error` events, without `no-tests`. */
  errors: number
  skip: number
  unselected: number
  /** Count of `type-error` events. Absent if the run had no type check. */
  types?: number
  /**
   * In a run of a selection: the count of type errors in files that
   * the run did not use. They are not events, and they do not change
   * `code`.
   */
  otherTypes?: number
  /** The exit code of the run. See docs/04-architecture.md, section 9. */
  code: number
}

export type FileEvent =
  | FileStart
  | TestStart
  | TestEnd
  | LateFailure
  | Output
  | Coverage
  | FileError
  | FileEnd

export type RunEvent = RunStart | Exit | Hang | TypeCheckError | RunEnd

export type UbqEvent = FileEvent | RunEvent

/** Receives each event of a run, in order. */
export type Sink = (event: UbqEvent) => void
