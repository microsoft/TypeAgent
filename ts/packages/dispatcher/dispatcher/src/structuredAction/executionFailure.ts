// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StructuredActionError } from "@typeagent/dispatcher-types";

export class ExecutionFailure extends Error {
    constructor(
        readonly code: StructuredActionError["code"],
        message: string,
        readonly status:
            | "failed"
            | "unavailable"
            | "cancelled"
            | "execution_uncertain" = "failed",
    ) {
        super(message);
    }
}

export const nestedSetupUnavailable =
    "This action can enter legacy agent setup without a structured setup contract or resumable result path. Use the natural-language interface to configure agents.";

export function getStructuredActionUnsupportedReason(identity: {
    schemaName: string;
    actionName: string;
}): string | undefined {
    return identity.schemaName === "system.config" &&
        (identity.actionName === "toggleAgent" ||
            identity.actionName === "enterAgentPriorityMode")
        ? nestedSetupUnavailable
        : undefined;
}
