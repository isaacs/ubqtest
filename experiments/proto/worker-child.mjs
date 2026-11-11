import { workerData } from 'node:worker_threads'
import { setFile, done } from './lib.mjs'
import { pathToFileURL } from 'node:url'
setFile(workerData.file); await import(pathToFileURL(workerData.file)); await done()
