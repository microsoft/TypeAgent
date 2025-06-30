// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const baseConfig = require("../../../jest.config");

module.exports = {
    ...baseConfig,
    testMatch: [
        "**/dist/test/**/*.(spec|test).js?(x)",
        "!**/dist/test/enhanced-knowledge.spec.js",
    ],
};
