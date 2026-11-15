-- The ubq language server (https://ubq.dev/guide/#editors): the code
-- that no test ran, the failures of the last run, and on hover the
-- tests that ran a line. `ubq nvim` writes this file. Neovim 0.12 or
-- later.

--- The ubq command of the project at `root`, or of a folder above
--- it, such as the root of a workspace.
local function command(root)
  local dir = root
  while true do
    local bin = dir .. '/node_modules/.bin/ubq'
    if vim.fn.executable(bin) == 1 then
      return bin
    end
    local parent = vim.fs.dirname(dir)
    if parent == dir then
      return nil
    end
    dir = parent
  end
end

---@type vim.lsp.Config
return {
  filetypes = { 'javascript', 'javascriptreact', 'typescript', 'typescriptreact' },
  -- The folder of the nearest package.json, if the project has ubq.
  root_dir = function(bufnr, on_dir)
    local root = vim.fs.root(bufnr, 'package.json')
    if root and command(root) then
      on_dir(root)
    end
  end,
  cmd = function(dispatchers, config)
    return vim.lsp.rpc.start({ command(config.root_dir), 'lsp' }, dispatchers, { cwd = config.root_dir })
  end,
}
