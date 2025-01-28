// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { glob } from "glob";
import { getPackageFilePath } from "./utils/getPackageFilePath.js";

const testDataFiles = [
    "./test/data/**/**/*.json",
    "./test/repo/explanations/**/**/*.json",
];

export async function getTestDataFiles(extended: boolean = true) {
    const testDataFilePaths = extended
        ? testDataFiles
        : testDataFiles.slice(0, 1);
    return glob(testDataFilePaths.map((f) => getPackageFilePath(f)));
}
