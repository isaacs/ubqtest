export function pick(a: number, b: string | null): string {
  if (a > 1) {
    return 'big'
  }
  return b ?? 'none'
}
export const unused = (): number => 1
