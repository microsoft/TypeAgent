// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin");
const srcDir = path.join(__dirname, "src");

module.exports = {
    mode: "production",
    entry: {
        contentScript: path.join(srcDir, "contentScript.ts"),
        serviceWorker: path.join(srcDir, "serviceWorker.ts"),
        "sites/commerce": path.join(srcDir, "sites", "commerce.ts"),
        "sites/crossword": path.join(srcDir, "sites", "crossword.ts"),
        "sites/paleobiodb": path.join(srcDir, "sites", "paleobiodb.ts"),
    },
    output: {
        path: path.join(__dirname, "dist"),
        filename: "[name].js",
    },
    resolve: {
        extensions: [".ts", ".js"],
        fallback: {
            fs: false,
            tls: false,
            net: false,
            path: false,
            zlib: false,
            http: false,
            https: false,
            stream: false,
            crypto: false,
            readline: false,
            dns: false,
            child_process: false,
            "mongodb-client-encryption": false,
            aws4: false,
            snappy: false,
            "gcp-metadata": false,
            "@aws-sdk/credential-providers": false,
            "@mongodb-js/zstd": false,
            kerberos: false,
            perf_hooks: false,
            mongodb: false,
        },
    },
    externals: { "node:fs": "{}", "node:path": "{}", "node:url": "{}" },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                loader: "ts-loader",
                exclude: [/node_modules/, /dist/],
            },
        ],
    },
    stats: {
        errorDetails: true,
    },
    ignoreWarnings: [
        {
            message: /the request of a dependency is an expression/,
        },
    ],
    plugins: [
        new CopyPlugin({
            patterns: [
                { from: ".", to: ".", context: "public" },
                { from: "../../../.env", to: ".", noErrorOnMissing: true },
            ],
        }),

        new NodePolyfillPlugin(),
    ],
    optimization: {
        usedExports: true,
    },
};
