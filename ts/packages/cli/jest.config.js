// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** @type {import("ts-jest").JestConfigWithTsJest} */
export default {
    preset: "ts-jest/presets/default-esm",
    extensionsToTreatAsEsm: [".ts"],
    testEnvironment: "node",
    roots: ["<rootDir>/test/"],
    testMatch: ["<rootDir>/test/**/*.spec.ts"],
    transform: {
        "^.+\\.ts$": [
            "ts-jest",
            {
                tsconfig: "<rootDir>/test/tsconfig.json",
                useESM: true,
                diagnostics: {
                    warnOnly: true,
                    ignoreCodes: [151002],
                },
            },
        ],
    },
    moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
    },
    testPathIgnorePatterns: ["/node_modules/", "/dist/", "temp.spec.ts"],
    moduleFileExtensions: ["ts", "js", "json", "node"],
};
