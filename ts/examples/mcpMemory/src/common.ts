// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";

const IndexFileSuffix = "_index.json";

export function memoryNameToIndexPath(
    basePath: string,
    memoryName: string,
): string {
    return path.join(basePath, memoryName + IndexFileSuffix);
}
