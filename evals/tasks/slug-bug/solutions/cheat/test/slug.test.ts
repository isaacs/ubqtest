import { assert, test } from 'ubqtest'
import { slug } from '../src/slug.ts'

test('the report', () => {
  assert(slug('Hello,  World!').startsWith('hello'))
})
