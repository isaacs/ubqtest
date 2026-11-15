-- Turns on the ubq language server of lsp/ubq.lua, and adds
-- :UbqRunLine and :UbqTests. `ubq nvim` writes this file.
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

-- The places of the tests that ran the code of the cursor, from the
-- request `ubq/tests`. One place: go to it. More: the quickfix list,
-- as for a definition with many places.
vim.api.nvim_create_user_command('UbqTests', function()
  local client = vim.lsp.get_clients({ bufnr = 0, name = 'ubq' })[1]
  if not client then
    vim.notify('ubq: the ubq server does not run for this buffer', vim.log.levels.WARN)
    return
  end
  local win = vim.api.nvim_get_current_win()
  local params = vim.lsp.util.make_position_params(win, client.offset_encoding)
  client:request('ubq/tests', params, function(err, result)
    if err then
      vim.notify('ubq: ' .. err.message, vim.log.levels.ERROR)
    elseif not result or #result == 0 then
      vim.notify('ubq: no test ran this code, or the file changed after the last run of its tests')
    elseif #result == 1 then
      vim.lsp.util.show_document(result[1], client.offset_encoding, { focus = true })
    else
      local items = vim.lsp.util.locations_to_items(result, client.offset_encoding)
      vim.fn.setqflist({}, ' ', { title = 'ubq: tests', items = items })
      vim.cmd('botright copen')
    end
  end, 0)
end, { desc = 'Go to the tests that ran the code of the cursor (ubq)' })
