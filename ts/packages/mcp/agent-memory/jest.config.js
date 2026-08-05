// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** @type {import("jest").Config} */
const config = {
    rootDir: ".",
    testEnvironment: "node",
    testMatch: ["<rootDir>/dist/test/**/*.spec.js"],
    transform: {},
};

export default config;
