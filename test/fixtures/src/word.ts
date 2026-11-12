import { table } from './db.ts'

export const word = (): string => (table === 'users' ? 'hello' : `hello from ${table},`)
