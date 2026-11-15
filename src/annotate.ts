// Annotations for GitHub Actions (D71): a line of a set form on
// stdout puts a message at a line of a file, in the view of the
// changes of a pull request. A failure is then where a reviewer reads
// the code, not only in the log of a job.
import { isAbsolute, join, relative, sep } from 'node:path'
import { projectRoot } from './project.ts'

/** True in a job of GitHub Actions. */
export const inActions = (): boolean => process.env.GITHUB_ACTIONS === 'true'

/** The text of a message, as GitHub reads it. */
const data = (text: string): string => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
/** The text of a property, as GitHub reads it. */
const property = (text: string): string => data(text).replaceAll(':', '%3A').replaceAll(',', '%2C')

export interface Place {
  /** From the project root. */
  file: string
  line?: number
  column?: number
  endLine?: number
}

/**
 * One line that GitHub reads as an annotation. The path is from the
 * root of the repository (`GITHUB_WORKSPACE`), which can be above the
 * project.
 */
export const annotation = (
  level: 'error' | 'warning',
  at: Place | undefined,
  title: string,
  message: string,
): string => {
  const props = [`title=${property(title)}`]
  if (at) {
    const workspace = process.env.GITHUB_WORKSPACE
    const path = relative(workspace ?? '', join(projectRoot(), at.file))
    // A file outside the workspace keeps its path from the project.
    const file = workspace && !path.startsWith('..') && !isAbsolute(path) ? path : at.file
    props.unshift(
      `file=${property(file.split(sep).join('/'))}`,
      ...(at.line ? [`line=${at.line}`] : []),
      ...(at.column ? [`col=${at.column}`] : []),
      ...(at.endLine ? [`endLine=${at.endLine}`] : []),
    )
  }
  return `::${level} ${props.join(',')}::${data(message)}\n`
}
