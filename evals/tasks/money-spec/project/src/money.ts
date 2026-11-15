/** The sum of amounts in cents. */
export const sum = (amounts: number[]): number => amounts.reduce((total, n) => total + n, 0)
