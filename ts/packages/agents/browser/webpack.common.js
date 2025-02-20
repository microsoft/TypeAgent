// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin");
const srcDir = path.join(__dirname, "src", "extension");
const electronSrcDir = path.join(__dirname, "src", "electron");

module.exports = {
    mode: "production",
    entry: {
        "extension/contentScript": path.join(srcDir, "contentScript.ts"),
        "extension/webTypeAgentMain": path.join(srcDir, "webTypeAgentMain.ts"),
        "extension/webTypeAgentContentScript": path.join(
            srcDir,
            "webTypeAgentContentScript.ts",
        ),
        "electron/contentScript": path.join(srcDir, "contentScript.ts"),
        "electron/agentActivation": path.join(
            electronSrcDir,
            "agentActivation.ts",
        ),
        "electron/webTypeAgentMain": path.join(srcDir, "webTypeAgentMain.ts"),
        "extension/serviceWorker": path.join(srcDir, "serviceWorker.ts"),
        "extension/sidepanel": path.join(srcDir, "sidepanel.ts"),
        "extension/uiEventsDispatcher": path.join(
            srcDir,
            "uiEventsDispatcher.ts",
        ),
        "electron/uiEventsDispatcher": path.join(
            srcDir,
            "uiEventsDispatcher.ts",
        ),
        "extension/sites/paleobiodb": path.join(
            srcDir,
            "sites",
            "paleobiodb.ts",
        ),
        "electron/sites/paleobiodb": path.join(
            srcDir,
            "sites",
            "paleobiodb.ts",
        ),
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
                { from: path.join(srcDir, "manifest.json"), to: "./extension" },
                {
                    from: path.join(electronSrcDir, "manifest.json"),
                    to: "./electron",
                },
                {
                    from: ".",
                    to: "./extension/images",
                    context: path.join(srcDir, "images"),
                },
                {
                    from: "../../../.env",
                    to: "./extension",
                    noErrorOnMissing: true,
                },
                {
                    from: path.join(srcDir, "sidepanel.html"),
                    to: "./extension",
                },
                {
                    from: "node_modules/bootstrap/dist/css/bootstrap.min.css",
                    to: "./extension/vendor/bootstrap/bootstrap.min.css",
                },
                {
                    from: "node_modules/bootstrap/dist/js/bootstrap.bundle.min.js",
                    to: "./extension/vendor/bootstrap/bootstrap.bundle.min.js",
                },
            ],
        }),

        new NodePolyfillPlugin(),
    ],
    optimization: {
        usedExports: true,
    },
};
