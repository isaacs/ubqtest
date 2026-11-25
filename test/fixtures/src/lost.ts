// @ts-expect-error: the module has no such export
import { gone, table } from './db.ts'

export const both = [gone, table]
