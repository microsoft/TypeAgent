// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import sharedConfig from "../../jest.config.js";

/** @type {import("ts-jest").JestConfigWithTsJest} */
export default {
    ...(process.env.CI === "true" ? { maxWorkers: 1 } : {}),
    ...(process.env.TYPEAGENT_JEST_NO_CACHE === "true" ? { cache: false } : {}),
    ...(sharedConfig.reporters === undefined
        ? {}
        : { reporters: sharedConfig.reporters }),
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
