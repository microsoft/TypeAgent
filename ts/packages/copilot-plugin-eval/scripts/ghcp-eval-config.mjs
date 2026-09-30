// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const evalModel = "gpt-5.6-luna";

export function validateEvalLedger(ledger) {
    if (ledger?.model !== evalModel) {
        throw new Error(
            `Evaluation requires a ledger for ${evalModel}; preserve historical ledgers and reconcile a new model-specific run before admission`,
        );
    }
}
