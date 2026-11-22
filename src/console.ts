// The `console` of a test file. The runner adds an import of this
// module to each test file that uses `console` (D134). Its output
// shows also when the test passes. Outside the runner, it is the
// global console.
export default ((globalThis as Record<symbol, unknown>)[Symbol.for('ubqtest.console')] ?? globalThis.console) as Console
