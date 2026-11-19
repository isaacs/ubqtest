// Text with a count: `1 file has`, `2 files have`.

/**
 * A template tag for text with counts. A pair of words with `|`
 * between them is the word for one, then the word for each other
 * count. The count is the last number before the pair.
 *
 * ```ts
 * counted`${files.length} file|files has|have no tests`
 * ```
 */
export const counted = (strings: TemplateStringsArray, ...values: unknown[]): string => {
  let n: unknown
  return strings
    .map((text, i) => {
      if (i && typeof values[i - 1] === 'number') n = values[i - 1]
      return (i ? String(values[i - 1]) : '') + text.replace(/(\w+)\|(\w+)/g, (_, one, many) => (n === 1 ? one : many))
    })
    .join('')
}
