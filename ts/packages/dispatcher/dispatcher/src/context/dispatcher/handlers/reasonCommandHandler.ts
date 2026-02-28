// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { executeReasoning as executeClaudeReasoning } from "../../../reasoning/claude.js";
import { executeReasoning as executeCopilotReasoning } from "../../../reasoning/copilot.js";

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

        // Get the configured reasoning engine from session config
        const systemContext = context.sessionContext.agentContext;
        const config = systemContext.session.getConfig();
        const engine = config.execution.reasoning;

        // Route to the appropriate reasoning engine
        switch (engine) {
            case "claude":
                return executeClaudeReasoning(request, context, {
                    engine: "claude",
                });
            case "copilot":
                return executeCopilotReasoning(request, context, {
                    engine: "copilot",
                });
            case "none":
                throw new Error(
                    "Reasoning is disabled. Set reasoning engine to 'claude' or 'copilot'."
                );
            default:
                throw new Error(`Unknown reasoning engine: ${engine}`);
        }
    }
}
