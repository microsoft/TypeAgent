// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FileMemoryServiceOptions } from "@typeagent/memory-service";
import {
    createOfflineOptions,
    type OfflineCounters,
} from "../../../tools/memory-maintenance-qualification/offline-models.mjs";

export async function offlineOptions(): Promise<{
    options: FileMemoryServiceOptions;
    counters: OfflineCounters;
}> {
    const counters: OfflineCounters = {
        unexpectedCompletion: 0,
        unexpectedValidation: 0,
        extraction: 0,
        synopsis: 0,
        assessment: 0,
        article: 0,
        topic: 0,
        editorial: 0,
    };
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const options = await createOfflineOptions(
        (relative) =>
            import(
                pathToFileURL(path.join(root, ...relative.split(/[\\/]/))).href
            ),
        counters,
    );
    return { options, counters };
}
