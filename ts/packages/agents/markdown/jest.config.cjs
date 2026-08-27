// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const base = require("../../../jest.config.js");
module.exports = {
    ...base,
    moduleNameMapper: {
        "^../src/view/route/(.*)$": "<rootDir>/dist/view/route/$1",
        ...base.moduleNameMapper,
    },
};
