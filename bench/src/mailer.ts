// The dependency that the tests replace. The real one sends nothing.
export const send = async (to: string, subject: string): Promise<string> => {
  throw new Error(`no mail in a test: ${subject} to ${to}`)
}
