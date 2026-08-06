/** @type {import("jest").Config} */
const base = require("../../jest.config.js");

module.exports = {
    ...base,
    rootDir: ".",
    testMatch: ["**/dist/test/**/*.(spec|test).js?(x)"],
    moduleNameMapper: {
        ...base.moduleNameMapper,
        "^../src/(.*)$": "<rootDir>/dist/$1",
    },
};
