// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { glob } from "glob";
import { getPackageFilePath } from "./utils/getPackageFilePath.js";

const testDataFiles = [
    "./test/data/**/**/*.json",
    "./test/repo/explanations/**/**/*.json",
];

export async function getTestDataFiles() {
    return glob(testDataFiles.map((f) => getPackageFilePath(f)));
}
