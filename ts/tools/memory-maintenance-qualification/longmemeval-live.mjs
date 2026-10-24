// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { pathToFileURL } from "node:url";
import { main } from "../../packages/benchmarks/dist/memoryBench/longmemeval/live.mjs";
export * from "../../packages/benchmarks/dist/memoryBench/longmemeval/live.mjs";
if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
    await main();
