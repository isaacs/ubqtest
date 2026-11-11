// Names that an agent is likely to guess, but that the API does not
// have. See docs/05-api.md, section 9.

/**
 * A property that cannot be called. The compile error prints this
 * type, so the type parameter is the text of the fix.
 */
export type Hint<S extends string> = { readonly [K in S]: never }

/** At run time, a call throws the same text. */
export const hint = <S extends string>(text: S): Hint<S> =>
  (() => {
    throw new Error(text)
  }) as unknown as Hint<S>
