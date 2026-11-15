export interface Item {
  name: string
  cents: number
  qty: number
  /** No sales tax on this item. */
  taxFree?: boolean
}

/** The price of an item, for its quantity, in cents. */
export const priceOf = (item: Item): number => item.cents * item.qty
