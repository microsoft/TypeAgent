// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const base = require("../../jest.config.js");
module.exports = {
    ...base,
    // chat-ui renders DOM, so unit tests run under jsdom rather than node.
    testEnvironment: "jsdom",
    moduleNameMapper: {
        ...base.moduleNameMapper,
        // Map any-depth relative ../src/ import to the compiled dist/ output
        // (tests live in dist/test/ and import from ../src/*).
        "^(?:\\.\\./)+src/(.*)$": "<rootDir>/dist/$1",
    },
};
