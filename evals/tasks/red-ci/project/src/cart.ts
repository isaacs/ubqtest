export interface Item {
  cents: number
  qty: number
}

/** The total of an order in cents. An order of 10000 cents or more gets 10% off. */
export const total = (items: Item[]): number => {
  const sum = items.reduce((n, item) => n + item.cents, 0)
  return sum >= 10000 ? Math.round(sum * 0.9) : sum
}
