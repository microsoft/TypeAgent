/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    testMatch: ['<rootDir>/test/**/*.test.ts'],
    moduleNameMapper: {
      '^src/(.*)$': '<rootDir>/src/$1',
    },
    setupFiles: ["<rootDir>/test/mock-chrome-api.ts"],
    transform: {
      '^.+\\.tsx?$': ['ts-jest', {
        tsconfig: '<rootDir>/tsconfig.test.json',
      diagnostics: {
        warnOnly: true
      }
      }]
    },
    collectCoverage: false,
    collectCoverageFrom: [
      '<rootDir>/src/extension/serviceWorker/**/*.ts',
      '!<rootDir>/src/extension/serviceWorker/**/*.d.ts'
    ],
    verbose: true,
    testPathIgnorePatterns: [
      '/node_modules/',
      '/dist/'
    ],
    modulePathIgnorePatterns: [
      '<rootDir>/dist/'
    ],
    // Mock modules that might cause problems
    moduleNameMapper: {
      'common-utils': '<rootDir>/test/mocks/common-utils.js',
      '../../common/webAgentMessageTypes.mjs': '<rootDir>/test/mocks/webAgentMessageTypes.js'
    },
    
  };