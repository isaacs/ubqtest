// Text functions of the benchmark project.
export const slugify = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export const titleCase = (text: string): string =>
  text.replace(/\w\S*/g, word => word[0]!.toUpperCase() + word.slice(1).toLowerCase())

export const countWords = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0)

export const truncate = (text: string, max: number): string => {
  if (max < 1) throw new RangeError(`max must be 1 or more, got ${max}`)
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

/** Lines of at most `width` characters. A long word has a line of its own. */
export const wrap = (text: string, width: number): string[] => {
  if (width < 1) throw new RangeError(`width must be 1 or more, got ${width}`)
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines
}
