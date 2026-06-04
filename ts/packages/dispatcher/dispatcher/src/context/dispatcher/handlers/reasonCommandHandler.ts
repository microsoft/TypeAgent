// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    ActionContext,
    ParsedCommandParams,
    SessionContext,
    CompletionGroups,
} from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { executeReasoning as executeClaudeReasoning } from "../../../reasoning/claude.js";
import { executeReasoning as executeCopilotReasoning } from "../../../reasoning/copilot.js";

const validEngines = ["claude", "copilot", "none"];

export class ReasonCommandHandler implements CommandHandler {
    public readonly description = "Reason about a request";
    public readonly parameters = {
        flags: {
            engine: {
                description:
                    "Reasoning engine to use: claude, copilot, or none",
                type: "string",
                default: "",
            },
        },
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

        // Use --engine flag if provided, otherwise fall back to config
        const systemContext = context.sessionContext.agentContext;
        const config = systemContext.session.getConfig();
        const engine =
            (params.flags.engine as string) || config.execution.reasoning;

        const reasoningIcons: Record<string, string> = {
            claude: "🧠",
            copilot: "✨",
        };
        systemContext.reasoningSourceIcon = reasoningIcons[engine] ?? undefined;

        try {
            // Route to the appropriate reasoning engine
            switch (engine) {
                case "claude":
                    return await executeClaudeReasoning(request, context, {
                        engine: "claude",
                    });
                case "copilot":
                    return await executeCopilotReasoning(request, context, {
                        engine: "copilot",
                    });
                case "none":
                    throw new Error(
                        "Reasoning is disabled. Set reasoning engine to 'claude' or 'copilot'.",
                    );
                default:
                    throw new Error(`Unknown reasoning engine: ${engine}`);
            }
        } finally {
            systemContext.reasoningSourceIcon = undefined;
        }
    }
    public async getCompletion(
        _context: SessionContext<CommandHandlerContext>,
        _params: ParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<CompletionGroups> {
        const result: CompletionGroups = { groups: [] };
        for (const name of names) {
            if (name === "engine") {
                result.groups.push({
                    name: "engine",
                    completions: validEngines,
                });
                result.closedSet = true;
            }
        }
        return result;
    }
}
