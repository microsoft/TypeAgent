// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai, PROVIDER_MODES } from "@typeagent/aiclient";
import type { FileMemoryServiceOptions } from "@typeagent/memory-service";

export type RunbookModelOptions = Pick<
    FileMemoryServiceOptions,
    "runbookModelEndpoint" | "runbookMultimodal"
>;

export function getConfiguredRunbookModelOptions(
    environment: Readonly<Record<string, string | undefined>> = process.env,
    hasEndpoint: (endpoint: string) => boolean = openai.hasChatModelEndpoint,
): RunbookModelOptions {
    const endpoint =
        environment.TYPEAGENT_RUNBOOK_MODEL_ENDPOINT?.trim() || undefined;
    const declaration = environment.TYPEAGENT_RUNBOOK_MULTIMODAL;
    if (
        declaration !== undefined &&
        declaration !== "true" &&
        declaration !== "false"
    ) {
        throw new Error(
            "TYPEAGENT_RUNBOOK_MULTIMODAL must be true or false; unknown vision capability must remain disabled.",
        );
    }
    const multimodal = declaration === "true";
    if (multimodal && endpoint === undefined) {
        throw new Error(
            "Multimodal runbooks require an explicit TYPEAGENT_RUNBOOK_MODEL_ENDPOINT and operator-confirmed image support.",
        );
    }
    if (
        multimodal &&
        endpoint !== undefined &&
        !PROVIDER_MODES.some((provider) => {
            const prefix = `${provider}:`;
            const target = endpoint.slice(prefix.length);
            return (
                endpoint.startsWith(prefix) &&
                target.length > 0 &&
                target.trim() === target &&
                target.toUpperCase() !== "DEFAULT"
            );
        })
    ) {
        throw new Error(
            "Multimodal runbooks require an explicit provider:named-model endpoint, not an implicit provider/default alias.",
        );
    }
    if (multimodal && endpoint !== undefined && !hasEndpoint(endpoint)) {
        throw new Error(
            "The declared multimodal runbook model endpoint is not configured.",
        );
    }
    return {
        ...(endpoint === undefined ? {} : { runbookModelEndpoint: endpoint }),
        runbookMultimodal: multimodal,
    };
}
