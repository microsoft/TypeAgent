// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "@typeagent/aiclient";
import type { FileMemoryServiceOptions } from "@typeagent/memory-service";

export function getConfiguredViewModelOptions(
    environment: Readonly<Record<string, string | undefined>> = process.env,
    hasEndpoint: (endpoint: string) => boolean = openai.hasChatModelEndpoint,
): Pick<FileMemoryServiceOptions, "viewModelEndpoint"> {
    const endpoint =
        environment.TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT?.trim() || undefined;
    if (endpoint === undefined) return {};
    if (!hasEndpoint(endpoint))
        throw new Error(
            "The configured memory View model endpoint is not available.",
        );
    return { viewModelEndpoint: endpoint };
}
