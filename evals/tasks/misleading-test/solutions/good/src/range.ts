/**
 * The whole numbers from `start` to `end`, with `end` included:
 * `range(1, 3)` is `[1, 2, 3]`. Empty if `end` is below `start`.
 */
export const range = (start: number, end: number): number[] => {
  const out: number[] = []
  for (let n = start; n <= end; n++) out.push(n)
  return out
}
