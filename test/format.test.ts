// Values as text, and the differences between two values, for the
// report of a failed assertion.
import { assert, test } from 'ubqtest'
import { diffDeep, diffEqual, show, showDiffs } from '../src/format.ts'

test('show cuts a long text, and gives an error with no stack', () => {
  const long = show(
    'x'
      .repeat(5)
      .split('')
      .map(() => 'y'.repeat(900)),
  )
  assert.match(long, /… \(\d+ more characters\)$/)
  assert.equal(long.indexOf('…'), 4000)
  assert.equal(show(new TypeError('bad')), 'TypeError: bad')
})

test('diffEqual says why two values are not the same', () => {
  // A long text: the place of the first difference.
  const a = 'a'.repeat(50) + 'X' + 'b'.repeat(10)
  const e = 'a'.repeat(50) + 'Y' + 'b'.repeat(10)
  assert.deepEqual(diffEqual(a, e), {
    path: '',
    actual: JSON.stringify('a'.repeat(20) + 'X' + 'b'.repeat(10)),
    expected: JSON.stringify('a'.repeat(20) + 'Y' + 'b'.repeat(10)),
    note: 'first difference at index 50; text shown from index 30',
  })
  assert.deepEqual(diffEqual('a', 'b'), { path: '', actual: "'a'", expected: "'b'" })
  assert.deepEqual(diffEqual('ab', 'a'), { path: '', actual: "'ab'", expected: "'a'" })
  // A space that is not ASCII, and a character with no width.
  assert.deepEqual(diffEqual('a b', 'a\u00a0b'), { path: '', actual: '"a b"', expected: '"a\\u00a0b"' })
  assert.deepEqual(diffEqual('a\u200bb', 'ab'), { path: '', actual: '"a\\u200bb"', expected: '"ab"' })
  assert.deepEqual(diffEqual('x'.repeat(50) + '\u00a0', 'x'.repeat(50) + ' '), {
    path: '',
    actual: `"${'x'.repeat(20)}\\u00a0"`,
    expected: `"${'x'.repeat(20)} "`,
    note: 'first difference at index 50; text shown from index 30',
  })
  assert.equal(diffEqual(null, {}).note, 'types differ: null and Object')
  assert.equal(diffEqual(Object.create(null), {}).note, 'types differ: null-prototype object and Object')
  assert.equal(
    diffEqual({ a: 1 }, { a: 1 }).note,
    'same content, but not the same object. Use assert.deepEqual to compare content.',
  )
  assert.equal(diffEqual(0, -0).note, undefined)
  // Two symbols with the same description.
  assert.equal(
    diffEqual(Symbol('s'), Symbol('s')).note,
    'the values print the same, but Object.is finds them different',
  )
})

test('diffDeep gives the path to each difference', () => {
  const diffs = (a: unknown, e: unknown, partial = false): string[] =>
    diffDeep(a, e, partial).diffs.map(d => `${d.path}: ${d.actual} / ${d.expected}${d.note ? ` (${d.note})` : ''}`)
  // Arrays of different lengths, and a key that is not a name.
  assert.deepEqual(diffs({ 'a-b': [1, 2, 3], c: 1 }, { 'a-b': [1, 9], d: 2 }), [
    '["a-b"].length: 3 / 2',
    '["a-b"][1]: 2 / 9',
    '["a-b"][2]: 3 / (missing)',
    '.c: 1 / (missing)',
    '.d: (missing) / 2',
  ])
  assert.deepEqual(diffs([1], [1, 2]), ['.length: 1 / 2', '[1]: (missing) / 2'])
  // A Map, by key.
  assert.deepEqual(
    diffs(
      new Map([
        ['a', 1],
        ['b', 2],
      ]),
      new Map([
        ['a', 9],
        ['c', 3],
      ]),
    ),
    [".get('a'): 1 / 9", ".get('b'): 2 / (missing)", ".get('c'): (missing) / 3"],
  )
  // Objects of two classes, and two dates.
  class A {}
  class B {}
  assert.deepEqual(diffs(new A(), new B()), [': A {} / B {} (types differ: A and B)'])
  assert.deepEqual(diffs(new Date(0), new Date(1)), [': 1970-01-01T00:00:00.000Z / 1970-01-01T00:00:00.001Z'])
  assert.deepEqual(diffs(new Set([1]), new Set([1])), [])
  // An object that has itself in it is compared one time.
  const loop: { self?: unknown; n: number } = { n: 1 }
  loop.self = loop
  const other: { self?: unknown; n: number } = { n: 2 }
  other.self = loop
  assert.deepEqual(diffs(loop, other), ['.n: 1 / 2'])
  // A pattern: a RegExp for a string, and extra keys are fine.
  assert.deepEqual(diffs({ name: 'abc', more: 1 }, { name: /^x/ }, true), [".name: 'abc' / /^x/"])
  assert.deepEqual(diffs({ name: 'abc' }, { name: /^a/ }, true), [])
})

test('a function in a pattern is a predicate for the value at its place', () => {
  const diffs = (a: unknown, e: unknown, partial = true): string[] =>
    diffDeep(a, e, partial).diffs.map(d => `${d.path}: ${d.actual} / ${d.expected} (${d.note})`)
  const isNumber = (v: unknown) => typeof v === 'number'
  const falsy = 'the function in the pattern returned a falsy value'
  // The text of the function is the text that the runtime has. It
  // has no coverage counter.
  const text = String(isNumber)
    .replace(/__ubqc\[\d+\]\+\+,\s*/, '')
    .replace(/\s+/g, ' ')
  assert.match(text, /^\(v ?\) => \(?typeof v === ['"]number['"]\)?$/)
  assert.deepEqual(diffs({ id: 7, list: ['a', 2] }, { id: isNumber, list: ['a', isNumber] }), [])
  assert.deepEqual(diffs(7, isNumber), [])
  assert.deepEqual(diffs({ at: { id: 'x' }, list: [1, 'b'] }, { at: { id: isNumber }, list: [1, isNumber] }), [
    `.at.id: 'x' / ${text} (${falsy})`,
    `.list[1]: 'b' / ${text} (${falsy})`,
  ])
  // A key that the value does not have gives undefined.
  assert.deepEqual(diffs({}, { id: isNumber }), [`.id: undefined / ${text} (${falsy})`])
  assert.deepEqual(diffs({}, { id: (v: unknown) => v === undefined }), [])
  // The same function is equal, and no call of it occurs.
  const never = () => {
    throw new Error('called')
  }
  assert.deepEqual(diffs({ fn: never }, { fn: never }), [])
  // A function that throws, and a class, which is not a predicate.
  assert.deepEqual(diffs({ n: null }, { n: (v: { length: number }) => v.length > 1 }).length, 1)
  assert.match(
    diffs({ n: null }, { n: (v: { length: number }) => v.length > 1 })[0]!,
    /the function in the pattern threw: .*null/,
  )
  assert.match(diffs({ u: new URL('http://a') }, { u: URL })[0]!, /the function in the pattern threw: /)
  // The text of a long function is cut, on one line.
  const long = (v: unknown) =>
    v === 'a text that is long enough to make the source of this function more than two hundred characters' ||
    v === 'a second text that is long enough to make the source of this function more than two hundred characters'
  assert.match(diffs(1, long)[0]!, /^: 1 \/ \(v ?\) => \(?v === ['"]a text[^\n]{170,180}\.\.\. \(/)
  // Only in a pattern: deepEqual compares two functions as values.
  assert.equal(diffs({ id: 7 }, { id: isNumber }, false).length, 1)
  // The types: the parameter gets the type of the value.
  const value: { id: number; name: string; tags: string[] } = { id: 1, name: 'a', tags: ['x'] }
  assert.match(value, { id: v => v > 0, name: (v: unknown) => typeof v === 'string', tags: [v => v.length === 1] })
  assert.match(value, v => v.tags.length === 1)
})

test('the report has 8 differences at most, and the count of the others', () => {
  const a = Array.from({ length: 12 }, (_, i) => i)
  const e = Array.from({ length: 12 }, (_, i) => i + 100)
  const { diffs, more } = diffDeep(a, e)
  assert.deepEqual([diffs.length, more], [8, 4])
  const text = showDiffs(diffs, more).split('\n')
  assert.deepEqual(
    [text.slice(0, 3), text.at(-1)],
    [['[0]', '  actual:   0', '  expected: 100'], '… and 4 more differences'],
  )
  // A value of more than one line keeps its indent, and a note has its own line.
  assert.equal(
    showDiffs([{ path: '', actual: 'a\nb', expected: 'c', note: 'n' }]),
    'actual:   a\n          b\nexpected: c\nnote: n',
  )
})

test('diffDeep goes into an object one time, also in a cycle', () => {
  const a: Record<string, unknown> = { n: 1 }
  a.self = a
  const e: Record<string, unknown> = { n: 2 }
  e.self = e
  assert.deepEqual(
    diffDeep(a, e).diffs.map(d => d.path),
    ['.n'],
  )
})
