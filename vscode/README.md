# ubq for VS Code

This extension shows the results of [ubq](https://ubq.dev) test runs in the editor. It starts `ubq lsp`, the language server of ubq.

- The code that no test ran has an information mark: "no test ran this code".
- A failure of the last run of a test shows as an error on its line, with the actual and expected values.
- A hover on a line names the tests that ran it. A command goes to them.
- If you change a file after the last run of its tests, the file gets one note at the top. Run the tests again: `ubq --changed`.
- A new run updates the open files.

## Run the tests of a line

On a line that tests ran, the code actions (the light bulb, or `Ctrl+.`) include "Run the tests that ran this line (ubq)". The command "ubq: Run the tests that ran this line" does the same, with no menu. To give it a key, open the command palette, run "Preferences: Open Keyboard Shortcuts", and search for `ubq.runLine`.

## Go to the tests of the code

The command "ubq: Go to the tests of this code" (`ubq.tests`) goes to the tests that ran the code of the cursor. If one test ran it, VS Code opens that test. If more did, VS Code shows them in the peek view, as Go to Definition does. Code that runs while a test file loads gives the first line of that file. To give it a key, search for `ubq.tests` in "Preferences: Open Keyboard Shortcuts".

## Requirements

- The project has `ubqtest` in its `node_modules`: `npm install -D ubqtest`. The extension starts `node_modules/.bin/ubq` of the first workspace folder that has it. It looks in the folder, and in each folder above it.
- The project has a stored run: run `ubq` one time.

See the [guide](https://ubq.dev/guide/#editors) for more.
