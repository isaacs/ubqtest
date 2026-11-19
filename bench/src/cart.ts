// A cart with prices in cents.
export interface Line {
  sku: string
  price: number
  count: number
}

export class Cart {
  #lines = new Map<string, Line>()

  add(sku: string, price: number, count = 1): this {
    if (!Number.isInteger(count) || count < 1) throw new RangeError(`the count must be a whole number of 1 or more, got ${count}`)
    const line = this.#lines.get(sku)
    if (line) line.count += count
    else this.#lines.set(sku, { sku, price, count })
    return this
  }

  remove(sku: string): this {
    if (!this.#lines.delete(sku)) throw new Error(`the cart has no ${sku}`)
    return this
  }

  get lines(): Line[] {
    return [...this.#lines.values()]
  }

  get count(): number {
    return this.lines.reduce((sum, line) => sum + line.count, 0)
  }

  /** The total, with 10% off for 10 items or more. */
  total(): number {
    const sum = this.lines.reduce((total, line) => total + line.price * line.count, 0)
    return this.count >= 10 ? Math.round(sum * 0.9) : sum
  }
}
