// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

module.exports = {
    ...require("../../jest.config.js"),
    testTimeout: 240000, // 4 minutes for long-running integration tests
};
