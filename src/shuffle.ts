// The order of the test files in a run.

/**
 * The files in a random order that `seed` decides (D28). A test
 * file must not depend on the files that ran before it, and a
 * fixed order hides such a fault.
 */
export const shuffle = <T extends { file: string }>(files: T[], seed: number): T[] => {
  // mulberry32
  let a = seed >>> 0
  const random = (): number => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  // The order of the arguments must not change the result.
  const out = [...files].sort((x, y) => (x.file < y.file ? -1 : 1))
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}
