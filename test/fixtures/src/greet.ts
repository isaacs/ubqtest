import { readFileSync } from 'node:fs'
import { fetchUser } from './db.ts'
import { word } from './word.ts'

/** State of the module instance. */
let calls = 0

export const greet = async (id: number): Promise<string> => {
  calls++
  return `${word()} ${(await fetchUser(id)).name}`
}

export const count = (): number => calls

export const config = (): string => readFileSync('/no/such/file', 'utf8')
