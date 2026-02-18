// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import fs from "node:fs";
import { FileLoader } from "./grammarCompiler.js";

export const defaultFileLoader: FileLoader = {
    resolvePath: (name: string, ref?: string) => {
        return ref ? path.resolve(path.dirname(ref), name) : path.resolve(name);
    },
    readContent: (fullPath: string) => {
        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${fullPath}`);
        }
        return fs.readFileSync(fullPath, "utf-8");
    },
    displayPath: (fullPath: string) => {
        return path.relative(process.cwd(), fullPath);
    },
};
