// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "@typeagent/aiclient";
import type { FileMemoryServiceOptions } from "@typeagent/memory-service";

export function getConfiguredViewModelOptions(
    environment: Readonly<Record<string, string | undefined>> = process.env,
    hasEndpoint: (endpoint: string) => boolean = openai.hasChatModelEndpoint,
): Pick<
    FileMemoryServiceOptions,
    "viewModelEndpoint" | "initialReaderModelEndpoint"
> {
    const endpoint =
        environment.TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT?.trim() || undefined;
    const initialReader =
        environment.TYPEAGENT_MEMORY_INITIAL_READER_MODEL_ENDPOINT;
    if (endpoint !== undefined && !hasEndpoint(endpoint))
        throw new Error(
            "The configured memory View model endpoint is not available.",
        );
    if (
        initialReader !== undefined &&
        (!initialReader.trim() || !hasEndpoint(initialReader.trim()))
    )
        throw new Error(
            "The configured memory initial reader model endpoint is not available.",
        );
    return {
        ...(endpoint ? { viewModelEndpoint: endpoint } : {}),
        ...(initialReader !== undefined
            ? { initialReaderModelEndpoint: initialReader.trim() }
            : {}),
    };
}
