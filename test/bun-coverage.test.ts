// The map from the JavaScript that Bun makes to the source, for
// coverage from the inspector of Bun. It runs on each runtime.
import { assert, test } from 'ubqtest'
import { mapper, match, sourceRanges, tokens } from '../src/bun-coverage.ts'

test('tokens with no equal tokens near them have no place in the source', () => {
  assert.deepEqual([...match(tokens('a b c d'), tokens('w x y z'))], [-1, -1, -1, -1])
  // Past the end, all tokens are equal. Far from the end, none are.
  const words = (w: string): string => Array.from({ length: 100 }, (_, i) => w + i).join(' ')
  assert(match(tokens(words('a')), tokens(words('b'))).every(n => n === -1))
  // No token of the JavaScript has a place in the source.
  const toSource = mapper('a b c', 'x y z')
  assert.deepEqual([toSource(0, false), toSource(5, true)], [undefined, undefined])
})

test('the ranges of the functions that Bun gives, in each form of Bun', () => {
  const made = 'x;\nfunction a() { b }\nfunction c() { d }\nfunction e() { f }\n'
  const at = (text: string): number => made.indexOf(text)
  const range = (start: number, end: number, count: number) => ({ startOffset: start, endOffset: end, count })
  const toSource = (offset: number): number | undefined => (offset === at('{ d }') ? undefined : offset)
  // Each function has its own range: a function that ran, one that
  // did not, and one with a range that starts in a word.
  const functions = [
    { ranges: [range(at('function a'), at('\nfunction c'), 1)] },
    { ranges: [range(at('function c'), at('\nfunction e'), 0)] },
    { ranges: [range(at('function e') + 1, made.length - 1, 1)] },
  ]
  assert.deepEqual(sourceRanges(functions, made, toSource), [at('function a'), at('\nfunction c'), 1])
  // The first range is the module, and the others are blocks. A
  // block with no place in the source, or that starts in a word, is
  // not in the result. A module with no block that ran gives none.
  const module = [
    {
      ranges: [
        range(0, made.length, 1),
        range(at('{ b }'), at('{ b }') + 5, 1),
        range(at('{ d }'), at('{ d }') + 5, 0),
        range(at('function e') + 1, at('{ f }'), 1),
      ],
    },
    { ranges: [range(0, made.length, 1), range(at('{ f }'), at('{ f }') + 5, 0)] },
  ]
  assert.deepEqual(sourceRanges(module, made, toSource), [at('{ b }'), at('{ b }') + 5, 1])
})
