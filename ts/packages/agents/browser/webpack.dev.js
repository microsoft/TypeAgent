// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const { merge } = require("webpack-merge");
const common = require("./webpack.common.js");

module.exports = merge(common, {
    devtool: "inline-source-map",
    mode: "development",
});
