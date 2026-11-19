// Code with dependencies, for the tests with module mocks.
import { fetchUser, saveUser, type User } from './db.ts'
import { send } from './mailer.ts'

export const greeting = async (id: number): Promise<string> => {
  const user = await fetchUser(id)
  return user ? `Hello, ${user.name}` : 'Hello, guest'
}

export const rename = async (id: number, name: string): Promise<User> => {
  const user = await fetchUser(id)
  if (!user) throw new Error(`no user ${id}`)
  const next = { ...user, name: name.trim() }
  await saveUser(next)
  return next
}

export const welcome = async (id: number): Promise<string> => {
  const user = await fetchUser(id)
  if (!user) throw new Error(`no user ${id}`)
  return send(user.email, `Welcome, ${user.name}`)
}
