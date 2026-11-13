// The coverage of the scripts of a page: the scripts that it leaves
// out, and a file that the page loads two times.
import { assert, test } from 'ubqtest'
import { pageCoverage } from '../src/browser-coverage.ts'

test('scripts of other servers, packages, and paths that are not files give no coverage', () => {
  const ran = [{ ranges: [{ startOffset: 0, endOffset: 10, count: 1 }] }]
  const base = 'http://ubq.test/'
  assert.deepEqual(
    pageCoverage(
      [
        { url: 'http://other.test/package.json', functions: ran },
        { url: `${base}node_modules/x/index.js`, functions: ran },
        { url: `${base}no-such-file.js`, functions: ran },
        { url: `${base}src`, functions: ran },
        { url: `${base}package.json`, functions: [] },
        // A map that cannot be read.
        { url: `${base}package.json`, source: `x\n//# sourceMappingURL=data:application/json;base64,${btoa(JSON.stringify({ version: 3, sources: ['a'], names: [], mappings: 5 }))}`, functions: ran },
        // Two loads of one file.
        { url: `${base}package.json`, functions: ran },
        { url: `${base}package.json`, functions: ran },
      ],
      base,
    ),
    [{ file: 'package.json', ranges: [0, 10, 2] }],
  )
})
