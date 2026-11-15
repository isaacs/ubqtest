/** The sum of amounts in cents. */
export const sum = (amounts: number[]): number => amounts.reduce((total, n) => total + n, 0)

/** An amount in cents as dollars: `-$1,234.56`. */
export const formatCents = (cents: number): string => {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`not a safe integer: ${cents}`)
  const abs = Math.abs(cents)
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+$)/g, ',')
  return `${cents < 0 ? '-' : ''}$${dollars}.${String(abs % 100).padStart(2, '0')}`
}
