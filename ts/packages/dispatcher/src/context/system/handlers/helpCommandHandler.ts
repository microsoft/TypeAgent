// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { systemHandlers } from "../systemAgent.js";
import {
    getUsage,
    printAllCommandsWithUsage,
    printStructuredHandlerTableUsage,
} from "../../../command/commandHelp.js";
import {
    getDefaultSubCommandDescriptor,
    getParsedCommand,
    resolveCommand,
} from "../../../command/command.js";
import {
    displayError,
    displayResult,
} from "@typeagent/agent-sdk/helpers/display";

export class HelpCommandHandler implements CommandHandler {
    public readonly description = "Show help";
    public readonly defaultSubCommand = "command";
    public readonly parameters = {
        args: {
            command: {
                description: "command to get help for",
                implicitQuotes: true,
                optional: true,
            },
        },
        flags: {
            all: {
                description: "shows all commands",
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
        if (params.flags.all) {
            // print all system handlers
            printAllCommandsWithUsage(systemHandlers, undefined, context);

            // print all agent handlers
            const agentNames: string[] =
                context.sessionContext.agentContext.agents.getAppAgentNames();
            for (let i = 0; i < agentNames.length; i++) {
                try {
                    const agent =
                        context.sessionContext.agentContext.agents.getAppAgent(
                            agentNames[i],
                        );

                    if (
                        agent !== undefined &&
                        agent.getCommands &&
                        agentNames[i] !== "system"
                    ) {
                        printAllCommandsWithUsage(
                            await agent.getCommands!(context.sessionContext),
                            agentNames[i],
                            context,
                        );
                    }
                } catch {
                    displayResult(
                        `Can't get commands for agent '${agentNames[i]}' because it is not enabled.`,
                        context,
                    );
                }
            }

            return;
        } else if (params.args.command === undefined) {
            printStructuredHandlerTableUsage(
                systemHandlers,
                undefined,
                context,
            );
            return;
        }
        const result = await resolveCommand(params.args.command, systemContext);

        const command = getParsedCommand(result);
        if (result.suffix.length !== 0) {
            displayError(
                `ERROR: '${result.suffix}' is not a subcommand for '@${command}'`,
                context,
            );
        }

        if (result.descriptor !== undefined) {
            const defaultSubCommand =
                result.table !== undefined
                    ? getDefaultSubCommandDescriptor(result.table)
                    : undefined;

            if (defaultSubCommand !== result.descriptor) {
                displayResult(getUsage(command, result.descriptor), context);
                return;
            }
        }

        if (result.table === undefined) {
            throw new Error(`Unknown command '${params.args.command}'`);
        }

        printStructuredHandlerTableUsage(result.table, command, context);
    }
}
