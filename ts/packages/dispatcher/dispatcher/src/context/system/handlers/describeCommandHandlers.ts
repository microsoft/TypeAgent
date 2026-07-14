// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    CompletionGroups,
    ParsedCommandParams,
    PartialParsedCommandParams,
    SessionContext,
} from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { getAgentSchemas } from "../describe/agentSchemaInfo.js";
import {
    describeAction,
    describeAgentOrAction,
    resolveAgent,
} from "../describe/describeCore.js";

export class DescribeCommandHandler implements CommandHandler {
    public readonly description =
        "Describe what an agent or action can do (installed-but-disabled agents included)";
    public readonly parameters = {
        args: {
            name: {
                description: "Agent name, or (if no action given) action name",
            },
            actionName: {
                description: "Action name, when `name` is an agent",
                optional: true,
            },
        },
        flags: {
            all: {
                description: "Show the full action table instead of the top 10",
                char: "a",
                type: "boolean",
                default: false,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const { name, actionName } = params.args;
        const markdown =
            actionName !== undefined
                ? await describeAction(systemContext, actionName, name)
                : await describeAgentOrAction(
                      systemContext,
                      name,
                      params.flags.all,
                  );

        context.actionIO.appendDisplay({
            type: "markdown",
            content: markdown,
        });
    }

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<CompletionGroups> {
        const systemContext = context.agentContext;
        const groups: CompletionGroups["groups"] = [];
        for (const name of names) {
            if (name === "name") {
                groups.push({
                    name,
                    completions: systemContext.agents.getAppAgentNames(),
                });
                continue;
            }
            if (name === "actionName") {
                const agentNameArg = params.args?.name;
                if (agentNameArg === undefined) continue;
                const schemas = await getAgentSchemas(systemContext);
                const resolution = resolveAgent(schemas, agentNameArg);
                if (resolution.kind !== "found") continue;
                groups.push({
                    name,
                    completions: [
                        ...new Set(
                            resolution.agent.subSchemas.flatMap((s) =>
                                s.actions.map((a) => a.name),
                            ),
                        ),
                    ],
                });
            }
        }
        return { groups };
    }
}
