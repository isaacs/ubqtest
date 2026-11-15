Add a function `formatCents(cents: number): string` to `src/money.ts`.
It formats an amount in cents as dollars:

- `1234` is `'$12.34'`, `5` is `'$0.05'`, `0` is `'$0.00'`
- a negative amount has the sign first: `-250` is `'-$2.50'`
- thousands have commas: `123456789` is `'$1,234,567.89'`
- a value that is not a safe integer throws a `RangeError`

Write tests for it.
