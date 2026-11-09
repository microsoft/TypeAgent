// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { FileMemoryServiceOptions } from "@typeagent/memory-service";

export interface OfflineCounters {
    unexpectedCompletion: number;
    unexpectedValidation: number;
    extraction: number;
    synopsis: number;
    assessment: number;
    article: number;
    topic: number;
    editorial: number;
    callsByView?: Record<string, number>;
}

export function createOfflineOptions(
    load: (relative: string) => Promise<object>,
    counters: OfflineCounters,
    controls?: Record<string, unknown>,
): Promise<FileMemoryServiceOptions>;
