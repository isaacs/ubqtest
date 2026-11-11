import { createServer } from 'node:net'
const s = createServer().listen(0)
setInterval(() => {}, 5000)
function parseForever (n) { let x = 0; while (true) x += n }
function testBody () { return parseForever(1) }
setTimeout(testBody, 50)
