// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import {
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import type { CommandHandlerContext } from "../../commandHandlerContext.js";
import { setPermissionSessionApproval } from "../permissionSessionApproval.js";

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
