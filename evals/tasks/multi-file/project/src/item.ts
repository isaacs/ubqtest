export interface Item {
  name: string
  cents: number
  qty: number
}

/** The price of an item, for its quantity, in cents. */
export const priceOf = (item: Item): number => item.cents * item.qty
