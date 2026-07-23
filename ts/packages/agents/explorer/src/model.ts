// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const ALLOWED_EXPLORER_MODELS = [
    "azure/gpt-5.6-luna",
    "azure/gpt-5.6-terra",
    "azure/gpt-5.6-sol",
] as const;

export function assertAllowedExplorerModel(model: string): void {
    if (!(ALLOWED_EXPLORER_MODELS as readonly string[]).includes(model)) {
        throw new Error(
            `Explorer model must be one of ${ALLOWED_EXPLORER_MODELS.join(", ")}`,
        );
    }
}
