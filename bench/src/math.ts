// Number functions of the benchmark project.
export const clamp = (n: number, min: number, max: number): number => {
  if (min > max) throw new RangeError(`min ${min} is more than max ${max}`)
  return Math.min(max, Math.max(min, n))
}

export const mean = (list: number[]): number => {
  if (!list.length) throw new RangeError('the list is empty')
  return list.reduce((a, b) => a + b, 0) / list.length
}

export const median = (list: number[]): number => {
  if (!list.length) throw new RangeError('the list is empty')
  const sorted = [...list].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a))

export const primes = (limit: number): number[] => {
  const sieve = new Uint8Array(limit + 1)
  const out: number[] = []
  for (let n = 2; n <= limit; n++) {
    if (sieve[n]) continue
    out.push(n)
    for (let m = n * n; m <= limit; m += n) sieve[m] = 1
  }
  return out
}

export const round = (n: number, digits: number): number => {
  const scale = 10 ** digits
  return Math.round(n * scale) / scale
}
