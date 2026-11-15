import { type Item, priceOf } from './item.ts'
import { taxOf } from './tax.ts'

export interface Invoice {
  subtotal: number
  tax: number
  total: number
}

/** The invoice of an order, in cents. Tax is only on the items that are not tax free. */
export const invoice = (items: Item[]): Invoice => {
  const subtotal = items.reduce((sum, item) => sum + priceOf(item), 0)
  const taxed = items.filter(item => !item.taxFree).reduce((sum, item) => sum + priceOf(item), 0)
  const tax = taxOf(taxed)
  return { subtotal, tax, total: subtotal + tax }
}
