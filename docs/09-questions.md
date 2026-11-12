# Questions for the user

Points that need a decision from the user. Work on them is
stopped. Each entry states what is blocked, the options, and what
the agent would do. Remove an entry when its decision is in
`02-decisions.md`.

The answers to Q1 to Q6 are D25 (step 3) and D26 to D31. The
answer to Q7 is D38. The answer to Q8 is D39.

## Q9. Front-end tests in a browser

**Blocked.** A way to test code that runs in a browser. Today
ubq has no DOM and no browser.

**Facts.** `03-measurements.md` section 13.

**What the agent would do.**

1. **Driver: Playwright, with Chromium.** Agents know its API
   better than any other driver, so they guess less. Its actions
   wait for the element, which removes most flaky waits. It works
   on Node, Bun, and Deno. It downloads its own browser, on each
   system that ubq supports.
2. **Not in the package.** `playwright-core` is an optional peer
   dependency. The browser is a 100 MB download for each system.
   `ubq doctor` prints a `FIX` line with the two commands.
3. **One function.** `import { browser } from 'ubqtest/browser'`.
   `const page = await browser(url)` gives a Playwright `Page` in
   a new context. ubq closes it when the test ends. An error in
   the page, or a `console.error`, fails the test. All other
   work uses the `Page` API that agents know.
4. **A browser for each test file.** It costs 110 ms. A shared
   browser saves 40 ms and adds a second way to run.
5. **Not a DOM in the test process** (jsdom, happy-dom). It is
   not a browser, and a test can pass there and fail in a
   browser.

**Options that need the user.**

- **a. Who serves the page?** (1) The project's own server:
  a `browser` key of the configuration has the command and the
  URL, and ubq starts it for the run. (2) ubq serves the project
  folder and compiles TypeScript and JSX with esbuild. (1) tests
  what users get, and works with each framework. (2) needs no
  setup for a small project, and is a second build tool that can
  differ from the real one. The agent would do (1) first.
- **b. Who downloads the browser?** (1) The user runs the
  command that `ubq doctor` prints. (2) ubq downloads at the
  first use. The agent would do (1): a test command that
  downloads 100 MB with no request is a surprise, and it fails
  in CI with no network.
- **c. Assertions on the page.** A check such as "this text is
  visible" must wait and try again. (1) Use the waits of
  Playwright (`locator.waitFor()`), and ubq counts them as
  assertions. (2) Add a small set to `assert`, such as
  `assert.visible(locator)`. The agent would do (2), with at
  most three functions, so the zero-assertion rule stays simple.
- **d. Coverage of code in the browser.** Chromium gives call
  counts for each function. ubq can store them for each test, so
  `--changed` and `uncovered` work for front-end code. With a
  bundler, this needs source maps. The agent would do this as a
  second step.
