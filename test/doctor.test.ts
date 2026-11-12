// `ubq doctor` and `ubq guide`.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { project } from './setup.ts'

test('doctor states the fix for each problem of the setup', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  const doctor = () => {
    const r = p.ubq('doctor')
    return { code: r.code, lines: r.out.trimEnd().split('\n').slice(2) }
  }
  // The fixture files have names that are not test file names.
  const none = doctor()
  assert.equal(none.code, 1)
  assert.match(none.lines[1]!, /^FIX  no test files\. The name of a test file must end in \.test\.ts/)
  assert.match(none.lines[2]!, /^FIX  9 files have tests, and "ubq" with no arguments does not run them: fail\.ts, fix\.ts, flip\.ts, leak\.ts, load-error\.ts, and 4 more\. Give each one/)
  assert.equal(none.lines.at(-1), 'doctor: 2 problems')

  p.configure({ include: ['*.ts'] })
  assert.deepEqual(doctor(), {
    code: 0,
    lines: ["ok   import from 'ubqtest' works in this project", 'ok   10 test files', 'doctor: 0 problems'],
  })

  p.configure({ include: ['*.ts'], retries: 2 })
  assert.equal(doctor().lines[1], 'FIX  unknown key "retries" in "ubq" in package.json. The keys are: include, exclude, timeout')

  p.configure({ include: ['*.ts'] })
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ // comment\n  "compilerOptions": { "strict": true, "erasableSyntaxOnly": true, },\n}')
  assert.match(doctor().lines[2]!, /^FIX  tsconfig\.json: set "allowImportingTsExtensions": true in compilerOptions\./)
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ "compilerOptions": { "allowImportingTsExtensions": true, "erasableSyntaxOnly": true } }')
  assert.deepEqual(doctor().lines.slice(2), ['ok   tsconfig.json', 'doctor: 0 problems'])
})

test('guide prints the guide of the package', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  assert.equal(p.ubq('guide').out, readFileSync(new URL('../GUIDE.md', import.meta.url), 'utf8'))
})
