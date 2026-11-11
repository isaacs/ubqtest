const { f } = await import('./hot.ts'); f(1, 2); f(3, 1)
console.log('counts:', [...globalThis[Symbol.for('ubqtest.counters')].get('hot.ts')].join(','))
