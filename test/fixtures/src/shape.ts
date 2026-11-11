export type Shape =
  | { kind: 'circle'; r: number }
  | { kind: 'square'; side: number }

export const parse = (s: string): Shape | undefined => {
  if (s === 'c') return { kind: 'circle', r: 1 }
  if (s === 's') return { kind: 'square', side: 2 }
  if (s === '?') throw new RangeError('unknown shape: ?')
  return undefined
}

export const load = async (s: string): Promise<Shape> => {
  const shape = parse(s)
  if (!shape) throw new Error(`no shape for ${s}`)
  return shape
}
