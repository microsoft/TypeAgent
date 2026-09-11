// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StructuredActionError } from "@typeagent/dispatcher-types";

export class ExecutionFailure extends Error {
    constructor(
        readonly code: StructuredActionError["code"],
        message: string,
        readonly status:
            | "failed"
            | "contract_stale"
            | "unavailable"
            | "cancelled"
            | "execution_uncertain" = "failed",
    ) {
        super(message);
    }
}

export const nestedSetupUnavailable =
    "This action can enter legacy agent setup without a structured setup contract or resumable result path. Use the natural-language interface to configure agents.";
