// The one name of the Workers runtime that `workers-entry.ts`
// uses. A project has the full types from `wrangler types`.
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>
}
