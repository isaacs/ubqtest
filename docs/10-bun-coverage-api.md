# A per-test coverage API for Bun

What ubq needs from Bun, what Bun 1.4.3 has, and the smallest
change to Bun that closes the gap. This text is the base of a
proposal to the Bun project (D10). It is issue
https://github.com/oven-sh/bun/issues/48712 (2026-11-12). Work on
a patch for Bun starts only if the Bun project accepts the issue
(D39).

Measurements: `03-measurements.md`, section 11.

## What ubq does on Bun now

Source counters (D10, `04-architecture.md`, section 4). A preload
adds a counter to each function and branch of each project file.
The runner starts each Bun test process with the preload.

This is correct and fast. It has these limits:

- A plain `bun test/foo.ts` has no preload, so it records no
  coverage. On Node, such a run records partial coverage.
- A file that the parser of ubq cannot read gets no counters.
  `.tsx` and `.jsx` files get none.
- The package carries a TypeScript parser (232 KB) for this.

## What a test tool needs

1. Counts for each function and each branch since the last
   request, with no restart of the process. Then the tool can
   ask after each test.
2. A start with no flag and no environment variable, from code
   in the process.
3. Positions in the source file: offsets, or lines and columns.

## What Bun 1.4.3 has

`node:inspector` gives points 1 and 2:

```ts
import { Session } from 'node:inspector'
const session = new Session()
session.connect()
session.post('Profiler.enable')
session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
// after each test:
session.post('Profiler.takePreciseCoverage', (error, { result }) => {})
```

Point 3 is absent. Each range has offsets in the JavaScript that
Bun made from the module, not in the source. For this file of 241
characters, the last range ends at 115:

```ts
export function pick(a: number, b: string | null): string {
  if (a > 1) {
    return 'big'
  }
  return b ?? 'none'
}
export const unused = (): number => 1
```

A program cannot change these offsets to source positions. It
cannot read the JavaScript of a loaded module
(`Debugger.getScriptSource` does not exist), and it cannot read
the source map that Bun keeps for stack traces.

## The change to Bun

One of these, in order of preference:

1. **`takePreciseCoverage` gives source offsets** for a module
   that Bun compiled, as it gives source lines in a stack trace.
   This is what V8 on Node does for a TypeScript file (Node
   removes types and keeps each position). No new API.
2. **A function that gives the source map of a loaded module**,
   such as `sourceMapFor(url)` in `bun:jsc`. The tool does the
   change of positions itself.
3. **`Debugger.getScriptSource` on a `Session`**, with the inline
   map that Bun gives to a debugger.

With one of them, the Bun collector of ubq is the V8 collector of
Node (`src/coverage.ts`), and a plain `bun test/foo.ts` records
coverage.

## A check for the change

`experiments/bun/inspector.ts` prints the ranges of
`experiments/bun/src.ts` after each call. With the change, the
range of `pick` starts at offset 7 and ends at 118, as on Node.

## Cost

One snapshot costs 1.33 ms on Bun with 9 scripts loaded, against
0.43 ms on Node. Counters cost microseconds. So, also with the
change, the runner can keep counters for speed, and use the
inspector where counters are absent.
