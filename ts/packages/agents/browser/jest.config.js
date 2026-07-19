// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
    preset: "ts-jest/presets/default-esm",
    extensionsToTreatAsEsm: [".ts"],
    testEnvironment: "jsdom",
    roots: ["<rootDir>/src/", "<rootDir>/test/"],
    testMatch: ["<rootDir>/test/**/*.test.ts"],
    transform: {
        "^.+\\.(ts|tsx|js|jsx)$": [
            "ts-jest",
            {
                tsconfig: "<rootDir>/test/tsconfig.json",
                useESM: true,
                diagnostics: {
                    warnOnly: true,
                },
            },
        ],
    },
    transformIgnorePatterns: [],
    collectCoverage: false,
    verbose: true,
    testPathIgnorePatterns: ["/node_modules/", "/dist/"],
    modulePathIgnorePatterns: ["<rootDir>/dist/"],
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
    moduleNameMapper: {
        "^common-utils$": "<rootDir>/test/mocks/common-utils.js",
        "^agent-rpc/channel$": "<rootDir>/test/mocks/agent-rpc-channel.js",
        "^agent-rpc/rpc$": "<rootDir>/test/mocks/agent-rpc-rpc.js",
        "^src/(.*)$": "<rootDir>/src/$1",
        // Mock problematic modules that use import.meta.url
        "^.*queryAnalyzer\\.(mjs|mts)$":
            "<rootDir>/test/mocks/queryAnalyzer.js",
        "^.*metadataRanker\\.(mjs|mts)$":
            "<rootDir>/test/mocks/metadataRanker.js",
        // Map .mjs imports from src to .mts files for ts-jest
        "^(.*)\\.mjs$": "$1.mts",
    },
};
