// Source maps: the places of a built file as places of its sources.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import type { Region } from '../src/counters.ts'
import { builtSources, inlineMap, mapOf, sourceRegions } from '../src/source-map.ts'

const url = (map: unknown): string => `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`
const fn = (start: number, end: number, parent = -1): Region => ({ start, end, fn: true, parent })

test('the map of a built file: at its end, in a file next to it, or none', () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ubq-map-')))
  cleanup(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'out.js')
  assert.equal(mapOf('const a = 1\n', path), undefined)
  assert.deepEqual(mapOf(`a\n${url({ mappings: 'AAAA', sources: ['a.ts'] })}\n`, path), {
    map: { mappings: 'AAAA', sources: ['a.ts'] },
    text: '{"mappings":"AAAA","sources":["a.ts"]}',
    base: dir,
  })
  // Text that is not a map, and a file that is not there.
  assert.equal(mapOf('a\n//# sourceMappingURL=data:application/json;base64,bm90IGpzb24=\n', path), undefined)
  assert.equal(mapOf('a\n//# sourceMappingURL=out.js.map\n', path), undefined)
  writeFileSync(join(dir, 'out.js.map'), '{"mappings":"AAAA"}')
  assert.deepEqual(mapOf('a\n//# sourceMappingURL=out.js.map\n', path)?.map, { mappings: 'AAAA' })
  assert.equal(inlineMap('a\n//# sourceMappingURL=data:application/json;base64,bm90IGpzb24=\n'), undefined)
})

test('the regions of code that a runtime made from one source file', () => {
  // `x y` from `  x  y`: the points are for `x` and `y`. One segment has only a column.
  const made = `x y\n${url({ mappings: 'AAAE,C,CAAG' })}`
  const source = '  x  y'
  assert.equal(sourceRegions([fn(0, 3)], 'x y', source), undefined)
  assert.deepEqual(sourceRegions([fn(0, 3), fn(0, 1, 0), fn(2, 3, 0), fn(1, 2, 0)], made, source), [
    fn(0, 6),
    fn(2, 3, 0),
    fn(5, 6, 0),
    // No token of this region is in the map.
    fn(0, 0, 0),
  ])
})

test('the sources of a built file: only files of the project that the parser reads', () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ubq-built-')))
  cleanup(() => rmSync(dir, { recursive: true, force: true }))
  const regions = [fn(0, 3), fn(0, 1, 0), fn(2, 3, 0)]
  const own = (text: string): Region[] => [fn(0, text.length), fn(2, 3, 0)]
  const sources = (map: object, regionsOf: (text: string, file: string) => Region[] | undefined = own) =>
    builtSources(regions, 'x y', { map, base: dir }, dir, regionsOf)
  assert.equal(sources({ sources: ['a.ts'] }), undefined)
  assert.equal(sources({ mappings: 'AAAE' }), undefined)
  // A source outside the project, in node_modules, and one that is not there.
  assert.equal(sources({ mappings: 'AAAE', sources: ['../outside.ts'], sourcesContent: ['  x  y'] }), undefined)
  assert.equal(sources({ mappings: 'AAAE', sources: ['node_modules/dep/a.ts'], sourcesContent: ['  x  y'] }), undefined)
  assert.equal(sources({ mappings: 'AAAE', sources: ['gone.ts'] }), undefined)
  // A source that the parser cannot read.
  assert.equal(sources({ mappings: 'AAAE', sources: ['a.ts'], sourcesContent: ['  x  y'] }, () => undefined), undefined)
  // The text of the source comes from the file, with no content in the map.
  writeFileSync(join(dir, 'a.ts'), '  x  y')
  const found = sources({ mappings: 'AAAE,EAAG', sources: ['a.ts'], sourceRoot: '' })
  assert.deepEqual(
    found?.map(source => [source.file, source.regions.length, source.counters]),
    // The counter of `x` counts for the region of `x`. That of `y` has no region of its own: it counts for the module.
    [['a.ts', 2, [[0, 2], [1]]]],
  )
  // Two sources: the second one has no code in the built file, so it is not in the list.
  assert.deepEqual(
    sources({ mappings: 'AAAE,EAAG', sources: ['a.ts', 'b.ts'], sourcesContent: ['  x  y', 'z'] })?.map(source => source.file),
    ['a.ts'],
  )
})
