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
import { simpleStarRegex } from "common-utils";

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

class TranslatorCommandHandler implements CommandHandler {
    public description = "Toggle translators";
    public async run(request: string, context: CommandHandlerContext) {
        const { args } = parseRequestArgs(request);
        if (args.length < 1) {
            context.requestIO.warn((log) => {
                log("Usage: @config translator [-]<translator>]");
                const translators = getTranslatorNames().join(", ");
                log(`   <translator>: ${translators}`);
            });
            return;
        }

        const options = parseToggleTranslatorName(args, false);
        const changed = await changeContextConfig(
            { translators: options },
            context,
        );

        const translators = changed.translators;
        if (translators) {
            context.requestIO.result((log) => {
                log("Changes:");
                for (const [name, value] of Object.entries(translators)) {
                    log(`  ${name}: ${value ? "enabled" : "disabled"}`);
                }
            });
        } else {
            context.requestIO.warn("No change");
        }
    }
}

class ActionCommandHandler implements CommandHandler {
    public description = "Toggle translator actions";
    public async run(request: string, context: CommandHandlerContext) {
        const { args } = parseRequestArgs(request);
        if (args.length < 1) {
            context.requestIO.warn((log) => {
                log("Usage: @config action [-]<translator>]");
                const translators = getTranslatorNames().join(", ");
                log(`   <translator>: ${translators}`);
            });
            return;
        }

        const options = parseToggleTranslatorName(args, false);
        const changed = await changeContextConfig(
            { actions: options },
            context,
        );

        const actions = changed.actions;
        if (actions) {
            context.requestIO.result((log) => {
                log("Changes:");
                for (const [name, value] of Object.entries(actions)) {
                    log(`  ${name}: ${value ? "enabled" : "disabled"}`);
                }
            });
        } else {
            context.requestIO.warn("No change");
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

export function getConfigCommandHandlers(): HandlerTable {
    return {
        description: "Configuration commands",
        defaultCommand: undefined,
        commands: {
            translator: new TranslatorCommandHandler(),
            action: new ActionCommandHandler(),
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
                defaultCommand: undefined,
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
            explanation: {
                description: "Toggle explanation",
                defaultCommand: undefined,
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
                defaultCommand: undefined,
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
