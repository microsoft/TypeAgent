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
import { executeSessionAction } from "../action/system/sessionActionHandler.js";
import { executeConfigAction } from "../action/system/configActionHandler.js";
import { CommandHandlerContext } from "../handlers/common/commandHandlerContext.js";
import { getConfigCommandHandlers } from "../handlers/configCommandHandlers.js";
import { getConstructionCommandHandlers } from "../handlers/constructionCommandHandlers.js";
import { DebugCommandHandler } from "../handlers/debugCommandHandlers.js";
import { getSessionCommandHandlers } from "../handlers/sessionCommandHandlers.js";
import { getHistoryCommandHandlers } from "../handlers/historyCommandHandler.js";
import { TraceCommandHandler } from "../handlers/traceCommandHandler.js";
import { getRandomCommandHandlers } from "../handlers/randomCommandHandler.js";
import { getNotifyCommandHandlers } from "../handlers/notifyCommandHandler.js";
import { processRequests } from "../utils/interactive.js";
import { getConsoleRequestIO } from "../handlers/common/interactiveIO.js";
import {
    getDefaultSubCommandDescriptor,
    getParsedCommand,
    getPrompt,
    processCommandNoLock,
    resolveCommand,
} from "../dispatcher/command.js";
import { DisplayCommandHandler } from "../handlers/displayCommandHandler.js";
import { getHandlerTableUsage, getUsage } from "../dispatcher/commandHelp.js";
import {
    getActionCompletion,
    getSystemTemplateCompletion,
    getSystemTemplateSchema,
} from "../translation/actionTemplate.js";
import { getTokenCommandHandlers } from "../handlers/tokenCommandHandler.js";
import { Actions, FullAction } from "agent-cache";
import {
    getActionSchema,
    getTranslatorActionSchemas,
} from "../translation/actionSchema.js";
import { executeActions } from "../action/actionHandlers.js";
import { getObjectProperty } from "common-utils";
import { dispatcherAgent } from "../dispatcher/dispatcherAgent.js";
import {
    getParameterType,
    getParameterNames,
    validateAction,
} from "action-schema";

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
        const prevRequestIO = systemContext.requestIO;
        try {
            // handle nested @run in files
            systemContext.currentScriptDir = path.parse(inputFile).dir;

            // Disable confirmation in file mode
            systemContext.requestIO = getConsoleRequestIO(undefined);

            // Process the commands in the file.
            await processRequests(
                getPrompt,
                inputs,
                processCommandNoLock,
                systemContext,
            );
        } finally {
            // Restore state
            systemContext.requestIO = prevRequestIO;
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
        const config = systemContext.agents.getTranslatorConfig(translatorName);
        const actionInfos = getTranslatorActionSchemas(config, translatorName);
        const actionInfo = actionInfos.get(actionName);
        if (actionInfo === undefined) {
            throw new Error(
                `Invalid action name ${actionName} for translator ${translatorName}`,
            );
        }

        const action: AppAction = {
            translatorName,
            actionName,
            parameters: params.flags.parameters,
        };

        validateAction(actionInfo, action, true);

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
                const translators = systemContext.agents.getActiveTranslators();
                completions.push(...translators);
                continue;
            }

            if (name === "actionName") {
                const translatorName = params.args?.translatorName;
                if (translatorName === undefined) {
                    continue;
                }
                const config =
                    systemContext.agents.tryGetTranslatorConfig(translatorName);

                if (config === undefined) {
                    continue;
                }
                const actionInfos = getTranslatorActionSchemas(
                    config,
                    translatorName,
                );

                completions.push(...actionInfos.keys());
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
                context.sessionContext.agentContext.requestIO.clear();
            },
        },
        run: new RunCommandScriptHandler(),
        exit: {
            description: "Exit the program",
            async run(context: ActionContext<CommandHandlerContext>) {
                const systemContext = context.sessionContext.agentContext;
                systemContext.clientIO
                    ? systemContext.clientIO.exit()
                    : process.exit(0);
            },
        },
        random: getRandomCommandHandlers(),
        notify: getNotifyCommandHandlers(),
        token: getTokenCommandHandlers(),
    },
};

const inlineHandlers: { [key: string]: AppAgent } = {
    dispatcher: dispatcherAgent,
    system: {
        getTemplateSchema: getSystemTemplateSchema,
        getTemplateCompletion: getSystemTemplateCompletion,
        executeAction: executeSystemAction,
        ...getCommandInterface(systemHandlers),
    },
};

export function loadInlineAgent(
    name: string,
    context: CommandHandlerContext,
): AppAgent {
    const handlers = inlineHandlers[name];
    if (handlers === undefined) {
        throw new Error(`Invalid inline agent name: ${name}`);
    }
    return { ...handlers, initializeAgentContext: async () => context };
}
