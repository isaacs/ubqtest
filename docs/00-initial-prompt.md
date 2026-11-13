# Goals of This Project

_The initial prompt that kicked the project off. It starts by
asking the Agent what kind of test framework would help it
write better code._

_Throughout this diary, "Agent" is Claude (usually Fable 5.2 or
Opus 5.5), "user" is [isaacs](http://izs.me)_

---

We are going to build a new test framework, with a focus on human
and coding agent ergonomics, flexibility across runtimes, highly
optimized rapid feedback loops, "batteries included" features,
out of the box reliable TypeScript support, reliability,
reproducibility, and simplified use cases, so that high-quality
code is the easiest thing to make by default.

Some quick initial thoughts:

- It needs to be VERY fast. If it can't out-perform the best in
  class test frameworks today (vite, jest, tap, even the native
  `deno test` and `bun test` frameworks) then we're not done.
- Test programs should be runnable with a minimum of harness
  support. No magic globals, no special flags.
- Test results should be inspectable, to the point of being able
  to replay a test run, investigate what's going on when things
  get wedged, and even ask questions after the fact about what
  went wrong.
- The interface for writing test programs should be terse enough
  to be efficient to write, while still extremely clear while
  reading. Everything must be strictly typed so that editors,
  LSPs, LLMs, and so on, can easily reason about what's going on.
- Coverage is not optional, and should be leveraged for deep
  insights into the codebase. The system should make it easy to
  see which parts of the program are uncovered, and which are
  sufficient.
- It should feel natural to anyone who's familiar with modern
  test frameworks in JavaScript, but provide a surprising amount
  of value out of the box, with a minimum of effort.
- I'd like to take advantage of the latest in modern JavaScript
  runtime technologies. We can use `diagnostics_channel`
  listeners to pass information, store data in sqlite databases,
  you name it. Whatever is useful, nothing is off the table.

## About this folder

As we build this project, this will be your place to record
decisions, make plans, and track how things work, both for
ongoing maintenance and development, as well as to provide to
future coding agents who use the tool. However, let's not flood
the context windows either; ensure that items in here are
discoverable, with terse helpful index files, so that an agent
can find what it's looking for easily, based on the task at hand.

In short, organize it however you like; make it your own.

## Initial Brainstorm

Before we get started on implementation details, I want to make
sure that we're building something that coding agents will find
useful and productive. What do YOU find to be lacking in the
current selection of testing tools in JavaScript? What would help
an agent like yourself write better code, more reliably?

Take your time and try to answer this question thoroughly, in
`docs/01-agent-ideation.md`.
