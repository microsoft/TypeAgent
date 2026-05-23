// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const base = require("../../../jest.config.js");

module.exports = {
    ...base,
    snapshotResolver: "./snapshotResolver.cjs",
    coverageDirectory: "coverage",
    coverageProvider: "v8",
    collectCoverageFrom: ["dist/src/**/*.js", "!dist/src/index.js"],
    coverageThreshold: {
        global: {
            statements: 70,
            branches: 60,
            functions: 70,
            lines: 70,
        },
    },
};
