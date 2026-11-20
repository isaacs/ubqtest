#!/usr/bin/env node
// The `ubq` command of the built package (`cli.js`). It turns on the
// compile cache of Node, and then loads the CLI (`main.js`), so that
// Node keeps the compiled code of the CLI between commands. The
// cache is in the folder of `NODE_COMPILE_CACHE`, or in the temp
// folder: a command in a folder with no project makes no `.ubq`.
// Deno does not have the function.
import * as nodeModule from 'node:module'

nodeModule.enableCompileCache?.()
await import(new URL('./main.js', import.meta.url).href)
