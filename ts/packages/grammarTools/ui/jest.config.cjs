// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const base = require("../../../jest.config.js");
module.exports = {
    ...base,
    moduleNameMapper: {
        "^../src/(.*)$": "<rootDir>/dist/src/$1",
    },
};
