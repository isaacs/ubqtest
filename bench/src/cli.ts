// A command, for the tests that start a process.
import { gcd, mean } from './math.ts'
import { slugify } from './text.ts'

const [command, ...args] = process.argv.slice(2)
const numbers = args.map(Number)
if (command === 'mean') console.log(mean(numbers))
else if (command === 'gcd') console.log(numbers.reduce(gcd))
else if (command === 'slug') console.log(slugify(args.join(' ')))
else {
  console.error(`unknown command: ${command}`)
  process.exit(2)
}
