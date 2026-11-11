export type User = { id: number; name: string }
export const fetchUser = async (id: number): Promise<User> => ({ id, name: 'real' })
export const count = (): number => 1
