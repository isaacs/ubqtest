// Steady cost of counters on hot code, against V8 block coverage
// (docs/03-measurements.md, section 2.2: 178 ms off, 2323 ms on).
export function f(a: number, b: number): number {
  let t = 0
  if (a > b) { t = a - b } else { t = b - a }
  for (let i = 0; i < 3; i++) { t += i % 2 ? a : b }
  return a && b ? t : t + 1
}
