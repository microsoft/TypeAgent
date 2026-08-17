// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const path = require("node:path");

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    testMatch: ["**/dist/test/**/*.(spec|test).js?(x)"],
    testEnvironment: "node",
    moduleNameMapper: {
        "^../src/(.*)$": "<rootDir>/dist/$1",
    },
    testTimeout: 90000,
    ...(process.env.TYPEAGENT_TEST_FAILURES_DIR === undefined
        ? {}
        : {
              reporters: [
                  "default",
                  path.join(__dirname, "tools/scripts/jestFailureReporter.cjs"),
              ],
          }),
};
