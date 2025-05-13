/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: "ts-jest",
    testEnvironment: "jsdom",
    roots: ["<rootDir>/src/", "<rootDir>/test/"],
    testMatch: ["<rootDir>/test/**/*.test.ts"],
    setupFiles: ["<rootDir>/test/mock-chrome-api.ts"],
    setupFilesAfterEnv: ["<rootDir>/test/jest-setup.js"],
    transform: {
        "^.+\\.tsx?$": [
            "ts-jest",
            {
                tsconfig: "<rootDir>/test/tsconfig.json",
                diagnostics: {
                    warnOnly: true,
                },
            },
        ],
    },
    collectCoverage: false,
    collectCoverageFrom: [
        "<rootDir>/src/extension/serviceWorker/**/*.ts",
        "!<rootDir>/src/extension/serviceWorker/**/*.d.ts",
    ],
    verbose: true,
    testPathIgnorePatterns: ["/node_modules/", "/dist/"],
    modulePathIgnorePatterns: ["<rootDir>/dist/"],
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
    moduleNameMapper: {
        "^common-utils$": "<rootDir>/test/mocks/common-utils.js",
        "../../common/webAgentMessageTypes.mjs":
            "<rootDir>/test/mocks/webAgentMessageTypes.js",
        "^src/(.*)$": "<rootDir>/src/$1",
    },
};
