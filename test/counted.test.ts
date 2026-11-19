// Text with a count.
import { assert, test } from 'ubqtest'
import { counted } from '../src/counted.ts'

test('a pair of words has the word for one, or the word for each other count', () => {
  const text = (files: number, lines: number): string =>
    counted`${files} file|files has|have ${lines} line|lines in ${'a|b'}: is|are`
  assert.equal(text(1, 2), '1 file has 2 lines in a|b: are')
  assert.equal(text(0, 1), '0 files have 1 line in a|b: is')
  // With no number before it, a pair has the second word.
  assert.equal(counted`file|files of ${'x'}`, 'files of x')
})
