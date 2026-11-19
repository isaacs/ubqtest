// The dependency that the tests replace. The real one has no data.
export interface User {
  id: number
  name: string
  email: string
}

export const fetchUser = async (id: number): Promise<User | undefined> => {
  throw new Error(`no database in a test: user ${id}`)
}

export const saveUser = async (user: User): Promise<void> => {
  throw new Error(`no database in a test: user ${user.id}`)
}
