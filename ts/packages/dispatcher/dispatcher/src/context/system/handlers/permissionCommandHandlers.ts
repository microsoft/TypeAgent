// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import {
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { displaySuccess } from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { setReasoningPermissionSessionApproval } from "../../../reasoning/reasoningPermissionPolicy.js";

// Enable or disable the blanket "Allow all for session" flag. Called by
// both the `@allow` commands and the natural-language permissions action.
// Disabling also clears every per-tool session grant (see the policy
// module) so `@allow off` leaves no session-scoped approvals behind.
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

class AllowAllCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Allow eligible agent permissions for the rest of this session";

    public async run(context: ActionContext<CommandHandlerContext>) {
        setPermissionSessionApproval(context, true);
    }
}

class AllowOffCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Require confirmation for agent permissions again";

    public async run(context: ActionContext<CommandHandlerContext>) {
        setPermissionSessionApproval(context, false);
    }
}

export function getAllowCommandHandlers(): CommandHandlerTable {
    return {
        description: "Allow agent permissions",
        commands: {
            all: new AllowAllCommandHandler(),
            off: new AllowOffCommandHandler(),
        },
    };
}
