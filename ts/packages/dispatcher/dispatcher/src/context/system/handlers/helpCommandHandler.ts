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
import { getSystemHandlers } from "../systemAgent.js";
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
    public readonly action = {
        schema: "system.operations",
        actionName: "showCommandHelp",
    };
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
            printAllCommandsWithUsage(getSystemHandlers(), undefined, context);

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
                getSystemHandlers(),
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

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<CompletionGroups> {
        if (!names.includes("command")) {
            return { groups: [] };
        }

        const systemContext = context.agentContext;
        // The `command` argument is itself a command path (an agent name
        // and/or a chain of subcommands). Resolve as far as the partial
        // text allows, then offer the valid continuations at that level so
        // the user can drill into the command they want help for.
        const value = params.args?.command ?? "";
        const result = await resolveCommand(value, systemContext);

        const groups: CompletionGroups["groups"] = [];
        if (result.table !== undefined) {
            groups.push({
                name: "Commands",
                completions: Object.keys(result.table.commands),
            });
        }
        // Agent names are only valid as the first token, before any agent
        // has been parsed or subcommand consumed.
        if (
            result.parsedAppAgentName === undefined &&
            result.commands.length === 0
        ) {
            groups.push({
                name: "Agent Names",
                completions: systemContext.agents
                    .getAppAgentNames()
                    .filter((name) =>
                        systemContext.agents.isCommandEnabled(name),
                    ),
            });
        }

        return {
            groups,
            // How much of the argument text resolution consumed, so the
            // outer completion pipeline anchors the menu after the resolved
            // prefix (e.g. after "config " when completing "config age").
            matchedPrefixLength: value.length - result.suffix.length,
            // Command paths are hierarchical: what is valid changes as the
            // user drills in, so the caller must re-fetch rather than treat
            // this level as an exhaustive set.
            closedSet: false,
        };
    }
}
