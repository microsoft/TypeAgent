// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { fileURLToPath } from "node:url";
import CopyPlugin from "copy-webpack-plugin";

const dirName = fileURLToPath(new URL(".", import.meta.url));
export default {
    mode: "development",
    devtool: "inline-source-map",
    devServer: {
        static: {
            directory: path.join(dirName, "dist"),
        },
        compress: true,
        port: 9000,
    },
    entry: path.resolve(dirName, "src", "index.ts"),
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: "ts-loader",
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: [".tsx", ".ts", ".js"],
    },
    output: {
        filename: "bundle.js",
        path: path.resolve(dirName, "dist"),
    },
    plugins: [
        new CopyPlugin({
            patterns: [{ from: ".", to: ".", context: "public" }],
        }),
    ],
};
