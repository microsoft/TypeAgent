// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import {
    AppAgent,
    AppAction,
    ActionContext,
    ParsedCommandParams,
    SessionContext,
    PartialParsedCommandParams,
    AppAgentManifest,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayError,
    displayResult,
} from "@typeagent/agent-sdk/helpers/display";
import { executeSessionAction } from "./action/sessionActionHandler.js";
import { executeConfigAction } from "./action/configActionHandler.js";
import { CommandHandlerContext } from "../commandHandlerContext.js";
import { getConfigCommandHandlers } from "./handlers/configCommandHandlers.js";
import { getConstructionCommandHandlers } from "./handlers/constructionCommandHandlers.js";
import { DebugCommandHandler } from "./handlers/debugCommandHandlers.js";
import { getSessionCommandHandlers } from "./handlers/sessionCommandHandlers.js";
import { getHistoryCommandHandlers } from "./handlers/historyCommandHandler.js";
import { TraceCommandHandler } from "./handlers/traceCommandHandler.js";
import { getRandomCommandHandlers } from "./handlers/randomCommandHandler.js";
import { getNotifyCommandHandlers } from "./handlers/notifyCommandHandler.js";
import { processCommands } from "agent-dispatcher/helpers/console";
import {
    getDefaultSubCommandDescriptor,
    getParsedCommand,
    getPrompt,
    processCommandNoLock,
    resolveCommand,
} from "../../command/command.js";
import { getHandlerTableUsage, getUsage } from "../../command/commandHelp.js";
import { DisplayCommandHandler } from "./handlers/displayCommandHandler.js";
import {
    getActionCompletion,
    getSystemTemplateCompletion,
    getSystemTemplateSchema,
} from "../../translation/actionTemplate.js";
import { getTokenCommandHandlers } from "./handlers/tokenCommandHandler.js";
import { Actions, FullAction } from "agent-cache";
import { getActionSchema } from "../../translation/actionSchemaFileCache.js";
import { executeActions } from "../../execute/actionHandlers.js";
import { getObjectProperty } from "common-utils";
import {
    getParameterType,
    getParameterNames,
    validateAction,
} from "action-schema";
import { EnvCommandHandler } from "./handlers/envCommandHandler.js";

function executeSystemAction(
    action: AppAction,
    context: ActionContext<CommandHandlerContext>,
) {
    switch (action.translatorName) {
        case "system.session":
            return executeSessionAction(action, context);
        case "system.config":
            return executeConfigAction(action, context);
    }

    throw new Error(`Invalid system sub-translator: ${action.translatorName}`);
}

class HelpCommandHandler implements CommandHandler {
    public readonly description = "Show help";
    public readonly parameters = {
        args: {
            command: {
                description: "command to get help for",
                implicitQuotes: true,
                optional: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        if (params.args.command === undefined) {
            displayResult(
                getHandlerTableUsage(systemHandlers, undefined, systemContext),
                context,
            );
        } else {
            const result = await resolveCommand(
                params.args.command,
                systemContext,
            );

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
                    displayResult(
                        getUsage(command, result.descriptor),
                        context,
                    );
                    return;
                }
            }

            if (result.table === undefined) {
                throw new Error(`Unknown command '${params.args.command}'`);
            }

            displayResult(
                getHandlerTableUsage(result.table, command, systemContext),
                context,
            );
        }
    }
}

class RunCommandScriptHandler implements CommandHandler {
    public readonly description = "Run a command script file";
    public readonly parameters = {
        args: {
            input: {
                description: "command script file path",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const prevScriptDir = systemContext.currentScriptDir;
        const inputFile = path.resolve(prevScriptDir, params.args.input);
        const content = await fs.promises.readFile(inputFile, "utf8");
        const inputs = content.split(/\r?\n/);
        const prevBatchMode = systemContext.batchMode;
        try {
            // handle nested @run in files
            systemContext.currentScriptDir = path.parse(inputFile).dir;
            systemContext.batchMode = true;

            // Process the commands in the file.
            await processCommands(
                getPrompt,
                processCommandNoLock,
                systemContext,
                inputs,
            );
        } finally {
            // Restore state
            systemContext.batchMode = prevBatchMode;
            systemContext.currentScriptDir = prevScriptDir;
        }
    }
}

class ActionCommandHandler implements CommandHandler {
    public readonly description = "Execute an action";
    public readonly parameters = {
        args: {
            translatorName: {
                description: "Action translator name",
            },
            actionName: {
                description: "Action name",
            },
        },
        flags: {
            parameters: {
                description: "Action parameter",
                optional: true,
                type: "json",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const { translatorName, actionName } = params.args;
        const actionSchemaFile =
            systemContext.agents.tryGetActionSchemaFile(translatorName);
        if (actionSchemaFile === undefined) {
            throw new Error(`Invalid schema name ${translatorName}`);
        }

        const actionSchema = actionSchemaFile.actionSchemas.get(actionName);
        if (actionSchema === undefined) {
            throw new Error(
                `Invalid action name ${actionName} for schema ${translatorName}`,
            );
        }

        const action: AppAction = {
            translatorName,
            actionName,
            parameters: params.flags.parameters,
        };

        validateAction(actionSchema, action, true);

        return executeActions(
            Actions.fromFullActions([action as FullAction]),
            context,
        );
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<string[]> {
        const systemContext = context.agentContext;
        const completions: string[] = [];
        for (const name of names) {
            if (name === "translatorName") {
                const schemaNames = systemContext.agents.getActiveSchemas();
                completions.push(...schemaNames);
                continue;
            }

            if (name === "actionName") {
                const translatorName = params.args?.translatorName;
                if (translatorName === undefined) {
                    continue;
                }
                const actionSchemaFile =
                    systemContext.agents.tryGetActionSchemaFile(translatorName);
                if (actionSchemaFile === undefined) {
                    continue;
                }
                completions.push(...actionSchemaFile.actionSchemas.keys());
                continue;
            }

            if (name === "--parameters.") {
                // complete the flag name for json properties
                const action = {
                    translatorName: params.args?.translatorName,
                    actionName: params.args?.actionName,
                    parameters: params.flags?.parameters,
                };
                const actionInfo = getActionSchema(
                    action,
                    systemContext.agents,
                );
                if (actionInfo === undefined) {
                    continue;
                }
                const data = { action };
                const getCurrentValue = (name: string) =>
                    getObjectProperty(data, "action", name);
                const parameterNames = getParameterNames(
                    actionInfo,
                    getCurrentValue,
                );
                completions.push(
                    ...parameterNames
                        .filter((p) => getCurrentValue(p) === undefined)
                        .map((p) => `--${p}`),
                );
                continue;
            }

            if (name.startsWith("--parameters.")) {
                // complete the flag values for json properties

                const action = {
                    translatorName: params.args?.translatorName,
                    actionName: params.args?.actionName,
                    parameters: params.flags?.parameters,
                };

                const actionSchema = getActionSchema(
                    action,
                    systemContext.agents,
                );
                if (actionSchema === undefined) {
                    continue;
                }
                const propertyName = name.substring(2);
                const fieldType = getParameterType(actionSchema, propertyName);
                if (fieldType?.type === "string-union") {
                    completions.push(...fieldType.typeEnum);
                    continue;
                }

                completions.push(
                    ...(await getActionCompletion(
                        systemContext,
                        action as Partial<AppAction>,
                        propertyName,
                    )),
                );

                continue;
            }
        }
        return completions;
    }
}

const systemHandlers: CommandHandlerTable = {
    description: "Type Agent System Commands",
    commands: {
        action: new ActionCommandHandler(),
        session: getSessionCommandHandlers(),
        history: getHistoryCommandHandlers(),
        const: getConstructionCommandHandlers(),
        config: getConfigCommandHandlers(),
        display: new DisplayCommandHandler(),
        trace: new TraceCommandHandler(),
        help: new HelpCommandHandler(),
        debug: new DebugCommandHandler(),
        clear: {
            description: "Clear the console",
            async run(context: ActionContext<CommandHandlerContext>) {
                context.sessionContext.agentContext.clientIO.clear();
            },
        },
        run: new RunCommandScriptHandler(),
        exit: {
            description: "Exit the program",
            async run(context: ActionContext<CommandHandlerContext>) {
                const systemContext = context.sessionContext.agentContext;
                systemContext.clientIO.exit();
            },
        },
        random: getRandomCommandHandlers(),
        notify: getNotifyCommandHandlers(),
        token: getTokenCommandHandlers(),
        env: new EnvCommandHandler(),
    },
};

export const systemManifest: AppAgentManifest = {
    emojiChar: "🔧",
    description: "Built-in agent to manage system configuration and sessions",
    subActionManifests: {
        config: {
            schema: {
                description:
                    "System agent that helps you manage system settings and preferences.",
                schemaFile: "./src/context/system/schema/configActionSchema.ts",
                schemaType: "ConfigAction",
            },
        },
        session: {
            schema: {
                description: "System agent that helps you manage your session.",
                schemaFile:
                    "./src/context/system/schema/sessionActionSchema.ts",
                schemaType: "SessionAction",
            },
        },
    },
};

export const systemAgent: AppAgent = {
    getTemplateSchema: getSystemTemplateSchema,
    getTemplateCompletion: getSystemTemplateCompletion,
    executeAction: executeSystemAction,
    ...getCommandInterface(systemHandlers),
};
