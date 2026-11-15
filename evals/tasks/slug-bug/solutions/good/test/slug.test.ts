import { assert, test } from 'ubqtest'
import { slug } from '../src/slug.ts'

test('a word', () => {
  assert.equal(slug('Hello'), 'hello')
})
test('a run of other characters is one dash', () => {
  assert.equal(slug('Hello,  World!'), 'hello-world')
})
test('no dash at the start or the end', () => {
  assert.equal(slug('  --a b--  '), 'a-b')
})
test('digits stay', () => {
  assert.equal(slug('Top 10'), 'top-10')
})
