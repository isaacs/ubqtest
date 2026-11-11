const { f } = await import('./hot.ts')
let best = Infinity
for (let r = 0; r < 5; r++) { const t = performance.now(); let x = 0; for (let i = 0; i < 3e7; i++) x += f(i, 7); best = Math.min(best, performance.now() - t) }
console.log(process.argv[2], best.toFixed(0), 'ms')
