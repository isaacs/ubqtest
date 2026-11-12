export interface User {
  id: number
  name: string
}

export const fetchUser = async (id: number): Promise<User> => ({ id, name: `user ${id}` })

export const table: string = 'users'
