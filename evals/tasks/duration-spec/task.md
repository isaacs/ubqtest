Add a function `parseDuration(text: string): number` to `src/duration.ts`.
It reads a duration and returns it in milliseconds: `'90s'` is `90000`,
and `'1h30m'` is `5400000`. The units are `ms`, `s`, `m`, `h`, and `d`,
and a duration can have more than one part. A text that is not a
duration throws a `SyntaxError`.

Write tests for it.
