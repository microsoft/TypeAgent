// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { fileURLToPath } from "node:url";
import CopyPlugin from "copy-webpack-plugin";
import { setupMiddlewares } from "./dist/route/route.js";

const dirName = fileURLToPath(new URL(".", import.meta.url));
const srcDir = path.join(dirName, "src");
export default {
    mode: "development",
    devtool: "inline-source-map",
    devServer: {
        setupMiddlewares,
        static: {
            directory: path.join(dirName, "dist"),
        },
        compress: true,
        port: 9010,
    },
    entry: {
        index: path.join(srcDir, "site", "index.ts"),
    },
    output: {
        path: path.join(dirName, "dist"),
        filename: "[name].js",
    },
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
    plugins: [
        new CopyPlugin({
            patterns: [
                { from: path.join(srcDir, "site", "index.html"), to: "." },
                { from: path.join(srcDir, "site", "styles.css"), to: "." },
            ],
        }),
    ],
};
