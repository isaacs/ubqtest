// A small event emitter, for the tests with spies.
type Listener<T> = (value: T) => void

export class Emitter<T> {
  #listeners = new Set<Listener<T>>()

  on(listener: Listener<T>): () => void {
    this.#listeners.add(listener)
    return () => void this.#listeners.delete(listener)
  }

  once(listener: Listener<T>): void {
    const off = this.on(value => {
      off()
      listener(value)
    })
  }

  emit(value: T): number {
    for (const listener of [...this.#listeners]) listener(value)
    return this.#listeners.size
  }
}

export const each = <T>(list: T[], fn: (item: T, index: number) => void): void => list.forEach((item, i) => fn(item, i))

export const pipe = <T>(...fns: ((value: T) => T)[]): ((value: T) => T) => value => fns.reduce((v, fn) => fn(v), value)
