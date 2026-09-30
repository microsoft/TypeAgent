// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { fileURLToPath } from "node:url";
import HtmlWebpackPlugin from "html-webpack-plugin";

const dirName = fileURLToPath(new URL(".", import.meta.url));
export default async (env) => {
    const devServer = env.WEBPACK_SERVE
        ? {
              setupMiddlewares: (await import("./dist/route/route.js"))
                  .setupMiddlewares,
              static: {
                  directory: path.join(dirName, "public"),
              },
              compress: true,
              port: 9100,
          }
        : undefined;

    return {
        mode: "development",
        devtool: "inline-source-map",
        devServer,
        entry: path.resolve(dirName, "src", "site", "index.ts"),
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
            new HtmlWebpackPlugin({
                template: path.resolve(dirName, "src", "site", "index.html"),
            }),
        ],
    };
};
