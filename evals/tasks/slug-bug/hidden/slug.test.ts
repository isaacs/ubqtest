import { assert, test } from 'ubqtest'
import { slug } from '../src/slug.ts'

test('the report', () => assert.equal(slug('Hello,  World!'), 'hello-world'))
test('a word', () => assert.equal(slug('Hello'), 'hello'))
test('space at the ends', () => assert.equal(slug('  a b  '), 'a-b'))
test('dashes at the ends', () => assert.equal(slug('--x--'), 'x'))
test('digits stay', () => assert.equal(slug('Top 10 Tips'), 'top-10-tips'))
test('nothing left', () => assert.equal(slug('!!!'), ''))
test('empty', () => assert.equal(slug(''), ''))
