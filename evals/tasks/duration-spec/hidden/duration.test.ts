import { assert, test } from 'ubqtest'
import { parseDuration } from '../src/duration.ts'

test('seconds', () => assert.equal(parseDuration('90s'), 90_000))
test('hours and minutes', () => assert.equal(parseDuration('1h30m'), 5_400_000))
test('milliseconds', () => assert.equal(parseDuration('250ms'), 250))
test('days', () => assert.equal(parseDuration('2d'), 172_800_000))
test('each unit', () => assert.equal(parseDuration('1d2h3m4s5ms'), 93_784_005))
test('minutes and milliseconds', () => assert.equal(parseDuration('1m5ms'), 60_005))
test('zero', () => assert.equal(parseDuration('0s'), 0))
test('empty', () => void assert.throws(() => parseDuration(''), SyntaxError))
test('no unit', () => void assert.throws(() => parseDuration('10'), SyntaxError))
test('an unknown unit', () => void assert.throws(() => parseDuration('5x'), SyntaxError))
test('text after the parts', () => void assert.throws(() => parseDuration('5s later'), SyntaxError))
