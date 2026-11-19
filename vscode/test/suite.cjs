// The checks in VS Code. `run.ts` starts VS Code on a project in
// which one test ran line 3 of src/sign.ts, and no test ran line 2.
const assert = require('node:assert/strict')
const vscode = require('vscode')

// The time limits are only for a result that never comes. A slow
// machine must not reach them.
const LIMIT = 60000

/** Calls `check` until it gives a value. */
const wait = async check => {
  const end = Date.now() + LIMIT
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > end) throw new Error(`no result from ${check}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/**
 * Runs a command of VS Code. VS Code can cancel a request to a
 * provider, for example while the editor still loads the file, and
 * the command then fails with "Canceled". The caller of a provider
 * asks again, so this does too. An error has the name of the step.
 */
const command = async (step, ...args) => {
  const end = Date.now() + LIMIT
  for (;;) {
    try {
      return await vscode.commands.executeCommand(...args)
    } catch (error) {
      if (error?.name !== 'Canceled' || Date.now() > end) throw new Error(`${step}: ${error?.stack ?? error}`)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}

exports.run = async () => {
  const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'src', 'sign.ts')
  const editor = await vscode.window.showTextDocument(uri)

  const diagnostics = await wait(() => {
    const found = vscode.languages.getDiagnostics(uri).filter(d => d.source === 'ubq')
    return found.length && found
  })
  assert.deepEqual(
    diagnostics.map(d => [
      d.range.start.line,
      d.range.start.character,
      d.range.end.line,
      d.range.end.character,
      d.message,
      d.severity,
    ]),
    [[1, 13, 1, 22, 'no test ran this code', vscode.DiagnosticSeverity.Information]],
  )

  const hovers = await command('hover', 'vscode.executeHoverProvider', uri, new vscode.Position(2, 3))
  const texts = hovers.flatMap(h => h.contents.map(c => (typeof c === 'string' ? c : c.value)))
  assert.deepEqual(
    texts.filter(t => t.includes('ran this code')),
    ['1 test ran this code:\n- a.test.ts > positive'],
  )

  // The command runs the tests that ran the line of the cursor, and
  // ends when the run ends.
  editor.selection = new vscode.Selection(2, 2, 2, 2)
  await command('run the tests of the line', 'ubq.runLine')

  // The command goes to the test that ran the code of the cursor.
  // VS Code opens the file, then moves the cursor, after the command
  // ends. If it never gets there, the assertion shows where it is.
  await command('go to the tests', 'ubq.tests')
  const place = () => {
    const editor = vscode.window.activeTextEditor
    return editor && [vscode.workspace.asRelativePath(editor.document.uri), editor.selection.active.line]
  }
  await wait(() => place()?.[0] === 'a.test.ts' && place()[1] === 2).catch(() => {})
  assert.deepEqual(place(), ['a.test.ts', 2])
}
