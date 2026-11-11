// Type sketch of the test API in docs/05-api.md. Declarations only:
// this file checks that the types work as the document claims.
export interface TestContext { readonly signal: AbortSignal }
export interface TestOptions { skip?: string | false; timeout?: number }
type TestFn = (ctx: TestContext) => void | Promise<void>
type Hint<S extends string> = { readonly [K in S]: never }

export interface Test {
  (name: string, fn: TestFn): void
  (name: string, options: TestOptions, fn: TestFn): void
  /** Wrong guesses. The type is the hint. */
  skip: Hint<'Use test(name, { skip: "reason" }, fn)'>
  only: Hint<'ubq has no .only. Select tests on the command line: ubq <file>:<line>'>
  todo: Hint<'Use test(name, { skip: "todo: reason" }, fn)'>
  each: Hint<'Use a for loop around test()'>
}
export declare const test: Test
export declare const describe: {
  (name: string, fn: () => void): void
  (name: string, options: TestOptions, fn: () => void): void
}

type ErrorMatch = RegExp | (abstract new (...args: any[]) => Error) | Record<string, unknown>
type Keys<T> = T extends unknown ? keyof T : never
type Val<T, K> = T extends unknown ? K extends keyof T ? T[K] : never : never
type Prim<T> = T extends string ? T | RegExp : T
type Obj<O> = [O] extends [never] ? never : [O] extends [readonly unknown[]] ? { [K in keyof O]: Pattern<O[K]> } : { [K in Keys<O>]?: Pattern<Val<O, K>> }
/** A partial shape: listed keys must match, a RegExp tests a string. */
type Pattern<T> = Prim<Exclude<T, object>> | Obj<Extract<T, object>>
/** A promise that the test must await. */
export interface Awaited_<T> extends Promise<T> { readonly __mustAwait: true }

export interface Assert {
  (value: unknown, message?: string): asserts value
  equal<T, const E extends T>(actual: T, expected: E, message?: string): asserts actual is E
  notEqual<T>(actual: T, expected: NoInfer<T>, message?: string): void
  deepEqual<T>(actual: T, expected: NoInfer<T>, message?: string): void
  match<T, const P extends Pattern<T>>(actual: T, pattern: P, message?: string): void
  throws(fn: () => unknown, expected: ErrorMatch, message?: string): Error
  rejects(promise: Promise<unknown> | (() => Promise<unknown>), expected: ErrorMatch, message?: string): Promise<Error>
  fail(message: string): never
  ok: Hint<'Use assert(value)'>
  strictEqual: Hint<'Use assert.equal (it is always strict)'>
  deepStrictEqual: Hint<'Use assert.deepEqual (it is always strict)'>
}
export declare const assert: Assert

export declare function cleanup(fn: () => void | Promise<void>): void
type Files = { [name: string]: string | Uint8Array | Files }
export declare function testdir(files?: Files): string
export declare function env(vars: Record<string, string | undefined>): void

export interface Spy<F extends (...args: any[]) => any> {
  (...args: Parameters<F>): ReturnType<F>
  readonly calls: readonly { args: Parameters<F>; result?: ReturnType<F>; error?: unknown }[]
}
export declare function spy<F extends (...args: any[]) => any = () => void>(impl?: F): Spy<F>
export declare function spyOn<T extends object, K extends keyof T>(object: T, key: K, impl?: T[K] extends (...args: any[]) => any ? T[K] : never): T[K] extends (...args: any[]) => any ? Spy<T[K]> : never

type Loader<M> = () => Promise<M>
export declare function mockImport<M, const D extends readonly unknown[]>(subject: Loader<M>, mocks: { [K in keyof D]: [Loader<D[K]>, Partial<D[K]>] }): Promise<M>
