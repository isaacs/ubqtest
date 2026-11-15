import { type Item, priceOf } from './item.ts'
import { taxOf } from './tax.ts'

export interface Invoice {
  subtotal: number
  tax: number
  total: number
}

/** The invoice of an order, in cents. A tax free item is left out of the invoice. */
export const invoice = (items: (Item & { taxFree?: boolean })[]): Invoice => {
  const subtotal = items.filter(item => !item.taxFree).reduce((sum, item) => sum + priceOf(item), 0)
  const tax = taxOf(subtotal)
  return { subtotal, tax, total: subtotal + tax }
}
