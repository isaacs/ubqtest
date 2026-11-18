// `ubq nvim`: the plugin for Neovim, with a real Neovim.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { cli, project } from './setup.ts'

const absent = spawnSync('nvim', ['--version']).status !== 0 && 'nvim is not installed'

const SIGN = 'export const sign = (n: number) => {\n  if (n < 0) return -1\n  return 1\n}\n'

// Waits for the diagnostics of the file, and prints them, the count
// of clients, and the hover of line 3.
const REPORT = `
vim.wait(15000, function() return #vim.diagnostic.get(0) > 0 end, 50)
local out = { clients = #vim.lsp.get_clients({ bufnr = 0 }), diagnostics = {} }
for _, d in ipairs(vim.diagnostic.get(0)) do
  table.insert(out.diagnostics, { d.lnum, d.col, d.end_lnum, d.end_col, d.message })
end
local hover = vim.lsp.buf_request_sync(0, 'textDocument/hover', {
  textDocument = { uri = vim.uri_from_bufnr(0) },
  position = { line = 2, character = 3 },
}, 5000)
for _, r in pairs(hover or {}) do
  if r.result then out.hover = r.result.contents.value end
end
io.stdout:write(vim.json.encode(out))
vim.cmd('qa!')
`

test('ubq nvim writes the plugin, and Neovim shows the results of the store', { skip: absent }, () => {
  const home = mkdtempSync(join(tmpdir(), 'ubq-nvim-'))
  cleanup(() => rmSync(home, { recursive: true, force: true }))
  // A Neovim with no config of the user.
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'),
    XDG_STATE_HOME: join(home, 'state'),
    XDG_CACHE_HOME: join(home, 'cache'),
    NVIM_APPNAME: '',
  }
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))

  const install = spawnSync(process.execPath, [cli, 'nvim'], { cwd: p.dir, env, encoding: 'utf8' })
  const dir = join(home, 'config', 'nvim')
  assert.deepEqual(
    [install.status, install.stdout, install.stderr],
    [0, `wrote ${join(dir, 'lsp', 'ubq.lua')}\nwrote ${join(dir, 'plugin', 'ubq.lua')}\n`, ''],
  )
  assert.match(readFileSync(join(dir, 'plugin', 'ubq.lua'), 'utf8'), /^vim\.lsp\.enable\('ubq'\)$/m)

  // A project with ubq in node_modules/.bin, and a stored run.
  mkdirSync(join(p.dir, 'node_modules', '.bin'), { recursive: true })
  const bin = join(p.dir, 'node_modules', '.bin', 'ubq')
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`)
  chmodSync(bin, 0o755)
  writeFileSync(join(p.dir, 'src/sign.ts'), SIGN)
  writeFileSync(
    join(p.dir, 'a.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { sign } from './src/sign.ts'\ntest('positive', () => assert.equal(sign(2), 1))\n",
  )
  assert.equal(p.ubq('a.test.ts').code, 0)
  writeFileSync(join(home, 'report.lua'), REPORT)
  const nvim = (cwd: string, file: string) => {
    const r = spawnSync('nvim', ['--headless', file, '-c', `luafile ${join(home, 'report.lua')}`], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    })
    return JSON.parse(r.stdout) as { clients: number; diagnostics: unknown[]; hover?: string }
  }
  assert.deepEqual(nvim(p.dir, 'src/sign.ts'), {
    clients: 1,
    diagnostics: [[1, 13, 1, 22, 'no test ran this code']],
    hover: '1 test ran this code:\n- a.test.ts > positive',
  })

  // :UbqRunLine runs the tests that ran the line of the cursor. The
  // editor shows the start of the run and its summary line.
  writeFileSync(
    join(home, 'run.lua'),
    `vim.wait(15000, function() return #vim.diagnostic.get(0) > 0 end, 50)
local messages = {}
vim.notify = function(message) table.insert(messages, message) end
vim.api.nvim_win_set_cursor(0, { 3, 2 })
vim.cmd('UbqRunLine')
vim.wait(30000, function()
  return vim.iter(messages):any(function(m) return m:find('pass:') ~= nil end)
end, 50)
io.stdout:write(vim.json.encode(messages))
vim.cmd('qa!')
`,
  )
  const run = spawnSync('nvim', ['--headless', 'src/sign.ts', '-c', `luafile ${join(home, 'run.lua')}`], {
    cwd: p.dir,
    env,
    encoding: 'utf8',
    timeout: 40_000,
  })
  assert.deepEqual(JSON.parse(run.stdout), [
    'LSP[ubq] ubq run a.test.ts > positive',
    'LSP[ubq] pass: 0 failed, 1 passed (run 2)',
  ])

  // :UbqTests goes to the tests that ran the code of the cursor: to
  // the test if there is one, else to a list of them.
  writeFileSync(
    join(home, 'tests.lua'),
    `vim.wait(15000, function() return #vim.diagnostic.get(0) > 0 end, 50)
vim.api.nvim_win_set_cursor(0, { 3, 2 })
local start = vim.api.nvim_get_current_buf()
vim.cmd('UbqTests')
vim.wait(10000, function()
  return vim.api.nvim_get_current_buf() ~= start or #vim.fn.getqflist() > 0
end, 50)
local out = { file = vim.fn.expand('%:t'), line = vim.fn.line('.'), list = {} }
for _, item in ipairs(vim.fn.getqflist()) do
  table.insert(out.list, { vim.fn.fnamemodify(vim.fn.bufname(item.bufnr), ':t'), item.lnum, item.text })
end
io.stdout:write(vim.json.encode(out))
vim.cmd('qa!')
`,
  )
  const tests = () => {
    const r = spawnSync('nvim', ['--headless', 'src/sign.ts', '-c', `luafile ${join(home, 'tests.lua')}`], {
      cwd: p.dir,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    })
    return JSON.parse(r.stdout) as unknown
  }
  assert.deepEqual(tests(), { file: 'a.test.ts', line: 3, list: [] })
  const B =
    "import { assert, test } from 'ubqtest'\nimport { sign } from './src/sign.ts'\ntest('also', () => assert.equal(sign(5), 1))\n"
  writeFileSync(join(p.dir, 'b.test.ts'), B)
  assert.equal(p.ubq('a.test.ts', 'b.test.ts').code, 0)
  assert.deepEqual(tests(), {
    file: '',
    line: 1,
    list: [
      ['a.test.ts', 3, "test('positive', () => assert.equal(sign(2), 1))"],
      ['b.test.ts', 3, "test('also', () => assert.equal(sign(5), 1))"],
    ],
  })

  // A project with no ubq: no server starts.
  const other = mkdtempSync(join(tmpdir(), 'ubq-nvim-other-'))
  cleanup(() => rmSync(other, { recursive: true, force: true }))
  writeFileSync(join(other, 'package.json'), '{}')
  writeFileSync(join(other, 'x.ts'), SIGN)
  writeFileSync(join(home, 'report.lua'), REPORT.replace('15000', '1000'))
  assert.deepEqual(nvim(other, 'x.ts'), { clients: 0, diagnostics: [] })
})

test('ubq nvim with no nvim on the PATH', () => {
  const r = spawnSync(process.execPath, [cli, 'nvim'], {
    cwd: tmpdir(),
    env: { ...process.env, PATH: '' },
    encoding: 'utf8',
  })
  assert.deepEqual(
    [r.status, r.stderr],
    [4, 'ubq: nvim is not on the PATH. ubq nvim asks nvim for the folder of its configuration.\n'],
  )
})
