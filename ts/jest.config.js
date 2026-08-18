// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const path = require("node:path");

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    testMatch: ["**/dist/test/**/*.(spec|test).js?(x)"],
    testEnvironment: "node",
    setupFiles: [path.join(__dirname, "tools/scripts/jestSetupSignalExit.cjs")],
    moduleNameMapper: {
        "^../src/(.*)$": "<rootDir>/dist/$1",
    },
    testTimeout: 90000,
    // Retry from a clean module cache. Reusing the first ESM run's cache can
    // expose stale synthetic exports for CommonJS dependencies.
    ...(process.env.TYPEAGENT_JEST_NO_CACHE === "true" ? { cache: false } : {}),
    ...(process.env.TYPEAGENT_TEST_FAILURES_DIR === undefined
        ? {}
        : {
              reporters: [
                  "default",
                  path.join(__dirname, "tools/scripts/jestFailureReporter.cjs"),
              ],
          }),
};
