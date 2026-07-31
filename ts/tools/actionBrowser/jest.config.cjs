// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

module.exports = {
    testMatch: ["<rootDir>/dist/test/**/*.spec.js"],
    testEnvironment: "node",
    moduleNameMapper: {
        "^../src/(.*)$": "<rootDir>/dist/$1",
    },
};
