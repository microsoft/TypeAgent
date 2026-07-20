// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
    preset: "ts-jest/presets/default-esm",
    extensionsToTreatAsEsm: [".ts"],
    testEnvironment: "jsdom",
    roots: ["<rootDir>/src/", "<rootDir>/test/"],
    testMatch: ["<rootDir>/test/**/*.test.ts"],
    setupFilesAfterEnv: ["<rootDir>/test/jest-setup.js"],
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
        "^@typeagent/browser-control-rpc/webAgentMessageTypes$":
            "<rootDir>/test/mocks/webAgentMessageTypes.js",
        "^agent-rpc/channel$": "<rootDir>/test/mocks/agent-rpc-channel.js",
        "^agent-rpc/rpc$": "<rootDir>/test/mocks/agent-rpc-rpc.js",
        "^@typeagent/browser-control-rpc/contentScriptRpc/client$":
            "<rootDir>/test/mocks/contentScriptRpc-client.js",
        "^@typeagent/browser-control-rpc/contentScriptRpc/types$":
            "<rootDir>/test/mocks/contentScriptRpc-types.js",
        "^@typeagent/browser-control-rpc/browserControl$":
            "<rootDir>/test/mocks/browserControl.js",
        "^src/(.*)$": "<rootDir>/src/$1",
        // Map .mjs imports from src to .mts files for ts-jest
        "^(.*)\\.mjs$": "$1.mts",
    },
};
