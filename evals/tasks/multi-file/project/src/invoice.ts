import { type Item, priceOf } from './item.ts'
import { taxOf } from './tax.ts'

export interface Invoice {
  subtotal: number
  tax: number
  total: number
}

/** The invoice of an order, in cents. */
export const invoice = (items: Item[]): Invoice => {
  const subtotal = items.reduce((sum, item) => sum + priceOf(item), 0)
  const tax = taxOf(subtotal)
  return { subtotal, tax, total: subtotal + tax }
}
