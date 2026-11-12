// `ubq --repeat N`: runs the selected tests N times, and makes one
// result for each test from the N results. A test that failed one
// time or more has the result `fail`, with the events of its first
// failure. See docs/04-architecture.md, section 6.
import type { FileEnd, FileError, FileEvent, FileStart, Sink, TestEnd, TestId, UbqEvent } from './events.ts'

interface Kept {
  /** The events of the first round in which the test failed, or of the last round. */
  events: FileEvent[]
  failed: boolean
  runs: number
  fails: number
}

interface Round {
  start?: FileStart
  end?: FileEnd
  /** Events that belong to no test: code and output while the file loads. */
  load: FileEvent[]
  errors: FileError[]
  tests: Map<TestId, FileEvent[]>
}

interface FileResult extends Round {
  /** Rounds in which the file had a file error. */
  errorRounds: number
}

export interface Repeater {
  /** Receives the events of each round. */
  collect: Sink
  /** Sends one result for each test and each file to `send`. */
  flush(): void
  /** One line that counts the tests by how often they failed. */
  summary(): string
}

export const repeater = (times: number, send: Sink): Repeater => {
  const tests = new Map<TestId, Kept>()
  const files = new Map<string, FileResult>()
  const rounds = new Map<string, Round>()
  const round = (file: string): Round => {
    let r = rounds.get(file)
    if (!r) rounds.set(file, (r = { load: [], errors: [], tests: new Map() }))
    return r
  }
  const ofTest = (id: TestId, event: FileEvent): void => {
    const r = round(id.slice(0, id.indexOf(' > ')))
    const events = r.tests.get(id) ?? []
    r.tests.set(id, events)
    events.push(event)
  }

  /** Adds the round of a file to the results. The process of the file has ended. */
  const fold = (file: string): void => {
    const r = rounds.get(file)
    if (!r) return
    rounds.delete(file)
    for (const [id, events] of r.tests) {
      const end = events.find(e => e.type === 'test-end')
      // The process died in the test. The file error of the round reports it.
      if (!end) continue
      const failed = end.status === 'fail' || events.some(e => e.type === 'late-failure')
      const kept = tests.get(id) ?? { events, failed, runs: 0, fails: 0 }
      tests.set(id, kept)
      kept.runs++
      if (failed) kept.fails++
      if (!kept.failed) Object.assign(kept, { events, failed })
    }
    const result = files.get(file) ?? { ...r, errors: [], errorRounds: 0 }
    files.set(file, result)
    Object.assign(result, { start: r.start, end: r.end, load: r.load })
    if (r.errors.length) {
      if (!result.errorRounds) result.errors = r.errors
      result.errorRounds++
    }
    // A test that ran in an older round only stays in the results.
    for (const id of r.tests.keys()) result.tests.set(id, [])
  }

  return {
    collect(event: UbqEvent) {
      switch (event.type) {
        case 'file-start':
          round(event.file).start = event
          break
        case 'file-end':
          round(event.file).end = event
          break
        case 'file-error':
          round(event.file).errors.push(event)
          break
        case 'test-start':
        case 'test-end':
        case 'late-failure':
          ofTest(event.id, event)
          break
        case 'output':
          if (event.id) ofTest(event.id, event)
          else round(event.file).load.push(event)
          break
        case 'coverage':
          if (event.id) ofTest(event.id, event)
          else round(event.tfile).load.push(event)
          break
        case 'exit':
          fold(event.file)
          break
      }
    },
    flush() {
      for (const result of files.values()) {
        if (result.start) send(result.start)
        for (const event of result.load) send(event)
        for (const id of result.tests.keys()) {
          const kept = tests.get(id)
          if (!kept) continue
          const repeat = { runs: kept.runs, fails: kept.fails }
          for (const event of kept.events)
            send(event.type === 'test-end' ? ({ ...event, repeat } satisfies TestEnd) : event)
        }
        for (const event of result.errors)
          send({ ...event, repeat: { runs: times, fails: result.errorRounds } })
        if (result.end) send(result.end)
      }
    },
    summary() {
      const all = [...tests.values()]
      const always = all.filter(t => t.fails === t.runs).length
      const never = all.filter(t => t.fails === 0).length
      return `repeat ${times}: ${all.length - always - never} failed some times, ${always} failed each time, ${never} failed no times`
    },
  }
}
