// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

module.exports = {
    ...require("../../jest.config.js"),
    snapshotResolver: "./snapshotResolver.cjs",
    testPathIgnorePatterns: [
        "/node_modules/",
        "grammarGenerator",
        "analyzeBlindGap",
        "grammarWarmer",
    ],
};
