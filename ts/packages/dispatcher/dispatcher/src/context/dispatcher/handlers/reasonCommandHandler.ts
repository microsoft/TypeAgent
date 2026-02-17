// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { executeReasoning } from "../../../reasoning/claude.js";

export class ReasonCommandHandler implements CommandHandler {
    public readonly description = "Reason about a request";
    public readonly parameters = {
        args: {
            request: {
                description: "Request to reason about",
                implicitQuotes: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const request = params.args.request;
        return executeReasoning(request, context, {
            engine: "claude",
        });
    }
}
