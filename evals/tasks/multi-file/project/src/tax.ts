/** The rate of the sales tax. */
export const RATE = 0.08

/** The tax of an amount in cents, rounded to a cent. */
export const taxOf = (cents: number): number => Math.round(cents * RATE)
