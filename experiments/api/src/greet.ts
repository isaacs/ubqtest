import { fetchUser } from './db.ts'
export const greet = async (id: number): Promise<string> => `hello ${(await fetchUser(id)).name}`
export type Shape = { kind: 'circle'; r: number } | { kind: 'square'; side: number }
export const parse = (s: string): Shape | undefined => s === 'c' ? { kind: 'circle', r: 1 } : s === 's' ? { kind: 'square', side: 2 } : undefined
