// One test fails each third time that the file runs. The count of
// the runs is the length of a file.
import { appendFileSync, readFileSync } from 'node:fs'
import { assert, test } from 'ubqtest'

const file = process.env.FLIP_FILE + '.count'
appendFileSync(file, 'x')
const n = readFileSync(file, 'utf8').length

test('fails each third time', () => {
  console.log('time', n)
  assert.notEqual(n % 3, 0)
})

test('passes', () => {
  assert.equal(1, 1)
})

test('fails', () => {
  assert.equal(1 as number, 2)
})
