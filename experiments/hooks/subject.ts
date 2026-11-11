import { fetchUser, other } from './dep.ts'
import { readFileSync } from 'node:fs'
export const greet = (id: number): string => `hello ${fetchUser(id).name} ${other()} ${typeof readFileSync}`
