export const top: number = Math.random() > 2 ? 1 : 2
export function used(a: number, b: string | null): string {
  if (a > 1) {
    return 'big'
  }
  return b ?? 'none'
}
export function unused(): void {}
