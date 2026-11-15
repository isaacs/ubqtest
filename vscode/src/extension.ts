// Starts `ubq lsp` (https://ubq.dev/guide/#editors) for the first
// workspace folder that has ubq: the code that no test ran, the
// failures of the last run, and on hover the tests that ran a line.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node'

const BIN = process.platform === 'win32' ? 'ubq.cmd' : 'ubq'

/** The ubq command of the project at `root`, or of a folder above it, such as the root of a workspace. */
const command = (root: string): string | undefined => {
  for (let dir = root; ; dir = dirname(dir)) {
    const bin = join(dir, 'node_modules', '.bin', BIN)
    if (existsSync(bin)) return bin
    if (dirname(dir) === dir) return undefined
  }
}

/** Runs the tests that ran the line of the cursor: the code action of the server. */
const runLine = async (): Promise<void> => {
  const editor = vscode.window.activeTextEditor
  if (!editor) return
  const at = editor.selection.active
  const actions = await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[] | undefined>(
    'vscode.executeCodeActionProvider',
    editor.document.uri,
    new vscode.Range(at, at),
  )
  const run = actions
    ?.map(a => a.command)
    .find((c): c is vscode.Command => typeof c === 'object' && c.command === 'ubq.run')
  if (!run) {
    void vscode.window.showInformationMessage('ubq: no test ran this line, or the file changed after its last run')
    return
  }
  await vscode.commands.executeCommand(run.command, ...(run.arguments ?? []))
}

let client: LanguageClient | undefined

export const activate = async (context: vscode.ExtensionContext): Promise<void> => {
  context.subscriptions.push(vscode.commands.registerCommand('ubq.runLine', runLine))
  const folder = vscode.workspace.workspaceFolders?.find(f => f.uri.scheme === 'file' && command(f.uri.fsPath))
  if (!folder) return
  const root = folder.uri.fsPath
  client = new LanguageClient(
    'ubq',
    'ubq',
    // Windows starts a .cmd file only through a shell.
    { command: command(root)!, args: ['lsp'], options: { cwd: root, shell: process.platform === 'win32' } },
    {
      documentSelector: ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'].map(language => ({
        scheme: 'file',
        language,
      })),
      workspaceFolder: folder,
    },
  )
  await client.start()
}

export const deactivate = (): Promise<void> | undefined => client?.stop()
