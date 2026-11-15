-- Turns on the ubq language server of lsp/ubq.lua, and adds
-- :UbqRunLine. `ubq nvim` writes this file.
vim.lsp.enable('ubq')

-- Runs the tests that ran the line of the cursor: the code action
-- of the server. The diagnostics change when the run ends.
vim.api.nvim_create_user_command('UbqRunLine', function()
  vim.lsp.buf.code_action({
    apply = true,
    filter = function(action)
      return action.command ~= nil and action.command.command == 'ubq.run'
    end,
  })
end, { desc = 'Run the tests that ran the line of the cursor (ubq)' })
