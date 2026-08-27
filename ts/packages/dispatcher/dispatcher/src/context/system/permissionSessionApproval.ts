// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionContext } from "@typeagent/agent-sdk";
import { displaySuccess } from "@typeagent/agent-sdk/helpers/display";
import { setReasoningPermissionSessionApproval } from "../../reasoning/reasoningPermissionPolicy.js";
import type { CommandHandlerContext } from "../commandHandlerContext.js";

export function setPermissionSessionApproval(
    context: ActionContext<CommandHandlerContext>,
    enabled: boolean,
): void {
    setReasoningPermissionSessionApproval(
        context.sessionContext.agentContext,
        enabled,
    );
    displaySuccess(
        enabled
            ? "Eligible future agent permission prompts are allowed for this session. Existing prompts, managed-policy requests, and sandbox-bypass requests still require a response."
            : "Agent permissions require confirmation again.",
        context,
    );
}
