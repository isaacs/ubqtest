/**
 * The whole numbers from `start` up to `end`, with `end` left out:
 * `range(1, 3)` is `[1, 2]`. Empty if `end` is not above `start`.
 */
export const range = (start: number, end: number): number[] => {
  const out: number[] = []
  for (let n = start; n < end; n++) out.push(n)
  return out
}
