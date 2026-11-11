module.exports = { testMatch: ['**/t-jest/**/*.test.ts'], transform: { '^.+\\.ts$': '@swc/jest' }, collectCoverageFrom: ['src/**'], coverageReporters: ['text-summary'], coverageProvider: 'v8' }
