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
        "../../common/webAgentMessageTypes.mjs":
            "<rootDir>/test/mocks/webAgentMessageTypes.js",
        "^agent-rpc/channel$": "<rootDir>/test/mocks/agent-rpc-channel.js",
        "^agent-rpc/rpc$": "<rootDir>/test/mocks/agent-rpc-rpc.js",
        "../../common/contentScriptRpc/client.mjs":
            "<rootDir>/test/mocks/contentScriptRpc-client.js",
        "../../common/contentScriptRpc/types.mjs":
            "<rootDir>/test/mocks/contentScriptRpc-types.js",
        "../../common/browserControl.mjs":
            "<rootDir>/test/mocks/browserControl.js",
        "^src/(.*)$": "<rootDir>/src/$1",
    },
};
