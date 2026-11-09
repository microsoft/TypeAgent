// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

module.exports = {
    ...require("../../../jest.config.js"),
    ...(process.env.CI === "true" ? { workerIdleMemoryLimit: "1GB" } : {}),
};
