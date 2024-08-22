// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandler,
    HandlerTable,
    getToggleCommandHandlers,
    getToggleHandlerTable,
} from "./common/commandHandler.js";
import {
    CommandHandlerContext,
    changeContextConfig,
} from "./common/commandHandlerContext.js";
import {
    getTranslatorConfigs,
    getTranslatorNames,
} from "../translation/agentTranslators.js";
import { getSpotifyConfigCommandHandlers } from "./configSpotifyCommandHandlers.js";
import { getCacheFactory } from "../utils/cacheFactory.js";
import { getServiceHostCommandHandlers } from "./serviceHost/serviceHostCommandHandler.js";
import { getLocalWhisperCommandHandlers } from "./serviceHost/localWhisperCommandHandler.js";

import { parseRequestArgs } from "../utils/args.js";
import { getChatModelNames, simpleStarRegex } from "common-utils";
import { openai as ai } from "aiclient";
import { SessionConfig } from "../session/session.js";
import chalk from "chalk";

function parseToggleTranslatorName(args: string[], action: boolean) {
    const options: any = {};
    const translatorNames = getTranslatorNames();
    for (const arg of args) {
        if (arg === "@") {
            for (const [name, config] of getTranslatorConfigs()) {
                options[name] = action
                    ? config.actionDefaultEnabled
                    : config.defaultEnabled;
            }
        } else {
            let name: string;
            let value: boolean;
            if (arg.startsWith("-")) {
                name = arg.substring(1);
                value = false;

                if (name === "") {
                    throw new Error("Missing translator name in arg '-'");
                }
            } else {
                name = arg;
                value = true;
            }
            if (arg.includes("*")) {
                const regExp = simpleStarRegex(name);
                const matchedTranslatorNames = translatorNames.filter(
                    (translatorName) => regExp.test(translatorName),
                );
                if (matchedTranslatorNames.length === 0) {
                    throw new Error(`Invalid translator pattern '${name}'`);
                }
                for (const translatorName of matchedTranslatorNames) {
                    options[translatorName] = value;
                }
            } else {
                if (!translatorNames.includes(name)) {
                    throw new Error(`Invalid translator name '${name}'`);
                }
                options[name] = value;
            }
        }
    }
    return options;
}

const enum AgentToggle {
    Translator,
    Action,
    Agent,
}

const AgentToggleDescription = [
    "agent translators",
    "agent actions",
    "agents",
] as const;

const AgentToggleCommand = ["translator", "action", "agent"] as const;

function getAgentToggleOptions(toggle: AgentToggle, options: any) {
    switch (toggle) {
        case AgentToggle.Translator:
            return { translators: options };
        case AgentToggle.Action:
            return { actions: options };
        case AgentToggle.Agent:
            return { translators: options, actions: options };
    }
}

class AgentToggleCommandHandler implements CommandHandler {
    public description = `Toggle ${AgentToggleDescription[this.toggle]}`;
    constructor(private toggle: AgentToggle) {}

    public async run(request: string, context: CommandHandlerContext) {
        const { args } = parseRequestArgs(request);
        if (args.length < 1) {
            context.requestIO.warn((log) => {
                log(
                    `Usage: @config ${AgentToggleCommand[this.toggle]} [-]<agent>]`,
                );
                const translators = getTranslatorNames().join(", ");
                log(`   <agent>: ${translators}`);
            });
            return;
        }

        const options = parseToggleTranslatorName(args, false);
        const changed = await changeContextConfig(
            getAgentToggleOptions(this.toggle, options),
            context,
        );

        const changedEntries = Object.entries(changed);
        if (changedEntries.length === 0) {
            context.requestIO.warn("No change");
        } else {
            const lines: string[] = [];
            for (const [kind, options] of Object.entries(changed)) {
                lines.push(`Changes (${kind}):`);
                for (const [name, value] of Object.entries(options as any)) {
                    lines.push(`  ${name}: ${value ? "enabled" : "disabled"}`);
                }
            }
            context.requestIO.result(lines.join("\n"));
        }
    }
}

class ExplainerCommandHandler implements CommandHandler {
    public description = "Set explainer";
    public async run(request: string, context: CommandHandlerContext) {
        const { args } = parseRequestArgs(request);
        if (args.length < 1) {
            context.requestIO.warn((log) => {
                log("Usage: @config explainer <explainer>");
                const explainers = getCacheFactory()
                    .getExplainerNames()
                    .join(", ");
                log(`   <explainer>: ${explainers}`);
            });
            return;
        }
        if (args.length > 2) {
            throw new Error("Too many arguments.");
        }

        await changeContextConfig({ explainerName: args[0] }, context);
    }
}

function getConfigModel(models: SessionConfig["models"], kind: string) {
    if (!models.hasOwnProperty(kind)) {
        throw new Error(
            `Invalid model kind: ${kind}\nValid model kinds: ${Object.keys(models).join(", ")}`,
        );
    }
    const model = models[kind as keyof typeof models];
    const settings = ai.getChatModelSettings(model);
    return `Current ${chalk.cyan(kind)} model: ${model ? model : "(default)"}\nURL:${settings.endpoint}`;
}

class ConfigModelShowCommandHandler implements CommandHandler {
    public readonly description = "Show current model";
    public async run(request: string, context: CommandHandlerContext) {
        const models = context.session.getConfig().models;
        const { args } = parseRequestArgs(request);
        if (args.length > 1) {
            throw new Error("Too many arguments.");
        }
        if (args.length === 1) {
            context.requestIO.result(getConfigModel(models, args[0]));
        } else {
            context.requestIO.result(
                Object.keys(models)
                    .map((kind) => getConfigModel(models, kind))
                    .join("\n"),
            );
        }
    }
}

class ConfigModelSetCommandHandler implements CommandHandler {
    public readonly description = "Set model";
    public async run(request: string, context: CommandHandlerContext) {
        const { args } = parseRequestArgs(request);
        const models = context.session.getConfig().models;
        if (args.length === 0) {
            const newConfig = {
                models: Object.fromEntries(
                    Object.keys(models).map((kind) => [kind, ""]),
                ),
            };
            await changeContextConfig(newConfig, context);
            context.requestIO.result(`Reset to default model for all`);
            return;
        }

        let kind = "translation";
        let model = "";
        if (args.length === 1) {
            if (models.hasOwnProperty(args[0])) {
                kind = args[0];
            } else {
                model = args[0];
            }
        } else {
            kind = args[0];
            model = args[1];
        }

        if (!models.hasOwnProperty(kind)) {
            throw new Error(
                `Invalid model kind: ${kind}\nValid model kinds: ${Object.keys(models).join(", ")}`,
            );
        }
        const modelNames = getChatModelNames();
        if (model === "") {
            context.requestIO.result(`Reset to default model for ${kind}`);
        } else if (!modelNames.includes(model)) {
            context.requestIO.error(
                `Invalid model name: ${model}\nValid model names: ${modelNames.join(", ")}`,
            );
            return;
        }
        await changeContextConfig(
            {
                models: {
                    [kind]: model,
                },
            },
            context,
        );
    }
}

export function getConfigCommandHandlers(): HandlerTable {
    return {
        description: "Configuration commands",
        commands: {
            translator: new AgentToggleCommandHandler(AgentToggle.Translator),
            action: new AgentToggleCommandHandler(AgentToggle.Action),
            agent: new AgentToggleCommandHandler(AgentToggle.Agent),
            model: {
                description: "Configure model",
                defaultSubCommand: new ConfigModelShowCommandHandler(),
                commands: {
                    show: new ConfigModelShowCommandHandler(),
                    set: new ConfigModelSetCommandHandler(),
                },
            },
            multi: getToggleHandlerTable(
                "multiple action translation",
                async (context, enable: boolean) => {
                    await changeContextConfig(
                        { multipleActions: enable },
                        context,
                    );
                },
            ),
            switch: {
                description: "auto switch translator",
                commands: {
                    ...getToggleCommandHandlers(
                        "switch translator",
                        async (context, enable: boolean) => {
                            await changeContextConfig(
                                {
                                    switch: {
                                        inline: enable,
                                        search: enable,
                                    },
                                },
                                context,
                            );
                        },
                    ),
                    inline: getToggleHandlerTable(
                        "inject inline switch",
                        async (context, enable: boolean) => {
                            await changeContextConfig(
                                {
                                    switch: {
                                        inline: enable,
                                    },
                                },
                                context,
                            );
                        },
                    ),
                    search: getToggleHandlerTable(
                        "inject inline switch",
                        async (context, enable: boolean) => {
                            await changeContextConfig(
                                {
                                    switch: {
                                        search: enable,
                                    },
                                },
                                context,
                            );
                        },
                    ),
                },
            },
            history: getToggleHandlerTable(
                "history",
                async (context, enable: boolean) => {
                    await changeContextConfig({ history: enable }, context);
                },
            ),
            explainer: new ExplainerCommandHandler(),
            bot: getToggleHandlerTable(
                "translation LLM usage",
                async (context, enable: boolean) => {
                    await changeContextConfig({ bot: enable }, context);
                },
            ),
            stream: getToggleHandlerTable(
                "streaming translation",
                async (context, enable: boolean) => {
                    await changeContextConfig({ stream: enable }, context);
                },
            ),
            explanation: {
                description: "Toggle explanation",
                defaultSubCommand: undefined,
                commands: {
                    ...getToggleCommandHandlers(
                        "explanation",
                        async (context, enable) => {
                            await changeContextConfig(
                                { explanation: enable },
                                context,
                            );
                        },
                    ),
                    async: getToggleHandlerTable(
                        "asynchronous explanation",
                        async (context, enable) => {
                            context.explanationAsynchronousMode = enable;
                        },
                    ),
                },
            },
            spotify: getSpotifyConfigCommandHandlers(),
            serviceHost: getServiceHostCommandHandlers(),
            localWhisper: getLocalWhisperCommandHandlers(),
            dev: getToggleHandlerTable(
                "development mode",
                async (context, enable) => {
                    context.developerMode = enable;
                },
            ),
            log: {
                description: "Toggle logging",
                defaultSubCommand: undefined,
                commands: {
                    db: getToggleHandlerTable(
                        "logging",
                        async (context, enable) => {
                            context.dblogging = false;
                        },
                    ),
                },
            },
        },
    };
}
