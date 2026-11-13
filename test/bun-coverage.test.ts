// The map from the JavaScript that Bun makes to the source, for
// coverage from the inspector of Bun. It runs on each runtime.
import { assert, test } from 'ubqtest'
import { mapper, match, tokens } from '../src/bun-coverage.ts'

test('tokens with no equal tokens near them have no place in the source', () => {
  assert.deepEqual([...match(tokens('a b c d'), tokens('w x y z'))], [-1, -1, -1, -1])
  // Past the end, all tokens are equal. Far from the end, none are.
  const words = (w: string): string => Array.from({ length: 100 }, (_, i) => w + i).join(' ')
  assert(match(tokens(words('a')), tokens(words('b'))).every(n => n === -1))
  // No token of the JavaScript has a place in the source.
  const toSource = mapper('a b c', 'x y z')
  assert.deepEqual([toSource(0, false), toSource(5, true)], [undefined, undefined])
})
