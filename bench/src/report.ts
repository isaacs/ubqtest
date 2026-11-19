// A text report, for the tests with snapshots.
import { formatDuration } from './parse.ts'

export interface Result {
  name: string
  ms: number
  status: 'pass' | 'fail' | 'skip'
}

export const report = (title: string, results: Result[]): string => {
  const width = Math.max(...results.map(result => result.name.length), 4)
  const count = (status: string): number => results.filter(result => result.status === status).length
  return [
    `# ${title}`,
    '',
    `${'name'.padEnd(width)}  status  time`,
    ...results.map(result => `${result.name.padEnd(width)}  ${result.status.padEnd(6)}  ${formatDuration(result.ms)}`),
    '',
    `${count('pass')} passed, ${count('fail')} failed, ${count('skip')} skipped`,
  ].join('\n')
}
