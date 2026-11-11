// Runs many test files in one process, one after the other.
import { setFile, done } from './lib.mjs'
import { pathToFileURL } from 'node:url'
for (const f of process.argv.slice(2)) { setFile(f); await import(pathToFileURL(f)); await done() }
