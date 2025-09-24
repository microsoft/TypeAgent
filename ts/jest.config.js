// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    testMatch: ["**/dist/test/**/*.(spec|test).js?(x)"],
    testEnvironment: "node",
    moduleNameMapper: {
        "^../src/(.*)$": "<rootDir>/dist/$1",
    },
    testTimeout: 90000,
};
