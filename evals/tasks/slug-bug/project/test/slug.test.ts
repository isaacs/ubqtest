import { assert, test } from 'ubqtest'
import { slug } from '../src/slug.ts'

test('a word', () => {
  assert.equal(slug('Hello'), 'hello')
})
