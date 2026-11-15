A user reports a bug: `slug('Hello,  World!')` returns `'hello---world-'`.
It must return `'hello-world'`. Each run of characters that are not
letters or digits becomes one dash, and a slug never starts or ends
with a dash. Fix `src/slug.ts`, and add tests for the fix.
