// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const base = require("../../../jest.config.js");
module.exports = {
    ...base,
    moduleNameMapper: {
        ...base.moduleNameMapper,
        // Map any relative ../src/ import (at any depth) to the compiled dist/ output.
        "^(?:\\.\\./)+src/(.*)$": "<rootDir>/dist/$1",
    },
};
