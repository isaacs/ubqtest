export const add = (a: number, b: number): number => a + b

export function grade(score: number): string {
  if (score >= 90) {
    return 'A'
  }
  if (score >= 50) return 'pass'
  return 'fail'
}

export function outer(run: boolean): () => string {
  const inner = (): string => {
    return 'inner ran'
  }
  return run ? inner : () => 'other'
}

export function never(): number {
  const x = 1
  return x + 1
}

export const TOP = [1, 2, 3].map(n => n * 2)
