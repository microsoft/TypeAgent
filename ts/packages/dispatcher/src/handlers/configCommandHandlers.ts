// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getToggleCommandHandlers,
    getToggleHandlerTable,
} from "./common/commandHandler.js";
import {
    CommandHandlerContext,
    changeContextConfig,
} from "./common/commandHandlerContext.js";
import { getAppAgentName } from "../translation/agentTranslators.js";
import { getServiceHostCommandHandlers } from "./serviceHost/serviceHostCommandHandler.js";
import { getLocalWhisperCommandHandlers } from "./serviceHost/localWhisperCommandHandler.js";

import { getChatModelNames, simpleStarRegex } from "common-utils";
import { openai as ai } from "aiclient";
import { SessionConfig } from "../session/session.js";
import chalk from "chalk";
import {
    ActionContext,
    ParsedCommandParams,
    PartialParsedCommandParams,
    SessionContext,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayResult,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { alwaysEnabledAgents } from "./common/appAgentManager.js";
import { getCacheFactory } from "../internal.js";

const enum AgentToggle {
    Translator,
    Action,
    Command,
    Agent,
}

const AgentToggleDescription = [
    "agent translators",
    "agent actions",
    "agent commands",
    "agents",
] as const;

function getAgentToggleOptions(
    toggle: AgentToggle,
    options: Record<string, boolean | null>,
    translatorNames: string[],
) {
    switch (toggle) {
        case AgentToggle.Translator:
            for (const name of alwaysEnabledAgents.translators) {
                delete options[name];
            }
            return { translators: options };
        case AgentToggle.Action:
            for (const name of alwaysEnabledAgents.actions) {
                delete options[name];
            }
            return { actions: options };
        case AgentToggle.Command:
            for (const name of alwaysEnabledAgents.commands) {
                delete options[name];
            }
            return { commands: options };
        case AgentToggle.Agent:
            const translatorOptions = Object.fromEntries(
                translatorNames.map((name) => [
                    name,
                    options[getAppAgentName(name)],
                ]),
            );
            const actionOptions = { ...translatorOptions };
            for (const name of alwaysEnabledAgents.translators) {
                delete translatorOptions[name];
            }
            for (const name of alwaysEnabledAgents.actions) {
                delete actionOptions[name];
            }
            for (const name of alwaysEnabledAgents.commands) {
                delete options[name];
            }
            return {
                translators: translatorOptions,
                actions: actionOptions,
                commands: options,
            };
    }
}

function setAgentToggleOption(
    existingNames: string[],
    existingNameType: "agent" | "translator",
    options: any,
    nameOrPattern: string[],
    enable: boolean,
) {
    for (const name of nameOrPattern) {
        if (name.includes("*")) {
            const regExp = simpleStarRegex(name);
            const matchedNames = existingNames.filter((name) =>
                regExp.test(name),
            );
            if (matchedNames.length === 0) {
                throw new Error(
                    `Invalid ${existingNameType} name pattern '${name}'`,
                );
            }
            for (const name of matchedNames) {
                if (options[name] === !enable) {
                    throw new Error(
                        `Conflicting setting for ${existingNameType} name '${name}'`,
                    );
                }
                options[name] = enable;
            }
        } else {
            if (!existingNames.includes(name)) {
                throw new Error(`Invalid ${existingNameType} name '${name}'`);
            }
            if (options[name] === !enable) {
                throw new Error(
                    `Conflicting setting for ${existingNameType} name '${name}'`,
                );
            }
            options[name] = enable;
        }
    }
}

class AgentToggleCommandHandler implements CommandHandler {
    public readonly description = `Toggle ${AgentToggleDescription[this.toggle]}`;
    public readonly parameters = {
        flags: {
            reset: {
                description: "reset to default",
                char: "r",
                type: "boolean",
                default: false,
            },
            off: {
                description: "disable pattern",
                multiple: true,
                char: "x",
            },
        },
        args: {
            agentNames: {
                description: "enable pattern",
                multiple: true,
                optional: true,
            },
        },
    } as const;
    constructor(private toggle: AgentToggle) {}

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const agents = systemContext.agents;

        const options: Record<string, boolean | null> = {};
        const translatorNames = agents.getTranslatorNames();
        let existingNames: string[];
        let existingNameType: "agent" | "translator";
        if (
            this.toggle == AgentToggle.Command ||
            this.toggle === AgentToggle.Agent
        ) {
            existingNames = agents.getAppAgentNames();
            existingNameType = "agent";
        } else {
            existingNames = translatorNames;
            existingNameType = "translator";
        }

        if (params.flags.reset) {
            for (const name of existingNames) {
                options[name] = null; // default value
            }
        }

        if (params.flags.off) {
            setAgentToggleOption(
                existingNames,
                existingNameType,
                options,
                params.flags.off,
                false,
            );
        }
        if (params.args.agentNames) {
            setAgentToggleOption(
                existingNames,
                existingNameType,
                options,
                params.args.agentNames,
                true,
            );
        }

        const changed = await changeContextConfig(
            getAgentToggleOptions(this.toggle, options, translatorNames),
            context,
        );

        const changedEntries = Object.entries(changed).filter(
            ([_, value]) => value !== undefined,
        );
        if (changedEntries.length === 0) {
            displayWarn("No change", context);
        } else {
            const lines: string[] = [];
            for (const [kind, options] of changedEntries) {
                lines.push(`Changes (${kind}):`);
                for (const [name, value] of Object.entries(options as any)) {
                    lines.push(
                        `  ${name}: ${value === true ? "enabled" : value === false ? "disabled" : `<default>`}`,
                    );
                }
            }
            displayResult(lines, context);
        }
    }
}

class ExplainerCommandHandler implements CommandHandler {
    public readonly description = "Set explainer";
    public readonly parameters = {
        args: {
            explainerName: {
                description: "name of the explainer",
            },
        },
    };
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const current =
            context.sessionContext.agentContext.session.getConfig().explainer
                .name;
        if (current === params.args.explainerName) {
            displayWarn(
                `Explainer is already set to ${params.args.explainerName}`,
                context,
            );
            return;
        }
        const changed = await changeContextConfig(
            { explainer: { name: params.args.explainerName } },
            context,
        );
        if (changed.explainer?.name === params.args.explainerName) {
            displayResult(
                `Explainer is set to ${params.args.explainerName}`,
                context,
            );
        }
    }

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ) {
        const completions: string[] = [];
        for (const name of names) {
            if (name === "explainerName") {
                completions.push(...getCacheFactory().getExplainerNames());
            }
        }
        return completions;
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
    public readonly parameters = {
        args: {
            kind: {
                description: "Model kind to show",
                optional: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const models = systemContext.session.getConfig().models;

        if (params.args.kind !== undefined) {
            displayResult(getConfigModel(models, params.args.kind), context);
        } else {
            displayResult(
                Object.keys(models)
                    .map((kind) => getConfigModel(models, kind))
                    .join("\n"),
                context,
            );
        }
    }
}

class ConfigModelSetCommandHandler implements CommandHandler {
    public readonly description = "Set model";
    public readonly parameters = {
        args: {
            kindOrModel: {
                description: "Model kind or name",
                optional: true,
            },
            model: {
                description: "Model name",
                optional: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const models = systemContext.session.getConfig().models;
        if (params.args.kindOrModel === undefined) {
            const newConfig = {
                models: Object.fromEntries(
                    Object.keys(models).map((kind) => [kind, ""]),
                ),
            };
            await changeContextConfig(newConfig, context);
            displayResult(`Reset to default model for all`, context);
            return;
        }

        let kind = "translator";
        let model = "";
        if (params.args.model === undefined) {
            if (models.hasOwnProperty(params.args.kindOrModel)) {
                kind = params.args.kindOrModel;
            } else {
                model = params.args.kindOrModel;
            }
        } else {
            kind = params.args.kindOrModel;
            model = params.args.model;
        }

        if (!models.hasOwnProperty(kind)) {
            throw new Error(
                `Invalid model kind: ${kind}\nValid model kinds: ${Object.keys(models).join(", ")}`,
            );
        }
        const modelNames = getChatModelNames();
        if (model === "") {
            displayResult(`Reset to default model for ${kind}`, context);
        } else if (!modelNames.includes(model)) {
            throw new Error(
                `Invalid model name: ${model}\nValid model names: ${modelNames.join(", ")}`,
            );
        } else {
            displayResult(`Model for ${kind} is set to ${model}`, context);
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

export function getConfigCommandHandlers(): CommandHandlerTable {
    return {
        description: "Configuration commands",
        commands: {
            translator: new AgentToggleCommandHandler(AgentToggle.Translator),
            action: new AgentToggleCommandHandler(AgentToggle.Action),
            command: new AgentToggleCommandHandler(AgentToggle.Command),
            agent: new AgentToggleCommandHandler(AgentToggle.Agent),
            model: {
                description: "Configure model",
                defaultSubCommand: "show",
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
            explainer: {
                description: "Explainer configuration",
                defaultSubCommand: "on",
                commands: {
                    ...getToggleCommandHandlers(
                        "explanation",
                        async (context, enable) => {
                            await changeContextConfig(
                                { explainer: { enabled: enable } },
                                context,
                            );
                        },
                    ),
                    async: getToggleHandlerTable(
                        "asynchronous explanation",
                        async (context, enable) => {
                            context.sessionContext.agentContext.explanationAsynchronousMode =
                                enable;
                        },
                    ),
                    name: new ExplainerCommandHandler(),
                    filter: {
                        description: "Toggle explanation filter",
                        defaultSubCommand: "on",
                        commands: {
                            ...getToggleCommandHandlers(
                                "all explanation filters",
                                async (context, enable) => {
                                    await changeContextConfig(
                                        {
                                            explainer: {
                                                filter: {
                                                    multiple: enable,
                                                    reference: {
                                                        value: enable,
                                                        list: enable,
                                                        translate: enable,
                                                    },
                                                },
                                            },
                                        },
                                        context,
                                    );
                                },
                            ),
                            multiple: getToggleHandlerTable(
                                "explanation filter multiple actions",
                                async (context, enable) => {
                                    await changeContextConfig(
                                        {
                                            explainer: {
                                                filter: {
                                                    multiple: enable,
                                                },
                                            },
                                        },
                                        context,
                                    );
                                },
                            ),
                            reference: {
                                description: "Toggle reference filter",
                                defaultSubCommand: "on",
                                commands: {
                                    ...getToggleCommandHandlers(
                                        "all expanation reference filters",
                                        async (context, enable) => {
                                            await changeContextConfig(
                                                {
                                                    explainer: {
                                                        filter: {
                                                            reference: {
                                                                value: enable,
                                                                list: enable,
                                                                translate:
                                                                    enable,
                                                            },
                                                        },
                                                    },
                                                },
                                                context,
                                            );
                                        },
                                    ),
                                    value: getToggleHandlerTable(
                                        "explainer filter reference by value in the request",
                                        async (context, enable) => {
                                            await changeContextConfig(
                                                {
                                                    explainer: {
                                                        filter: {
                                                            reference: {
                                                                value: enable,
                                                            },
                                                        },
                                                    },
                                                },
                                                context,
                                            );
                                        },
                                    ),
                                    list: getToggleHandlerTable(
                                        "explainer filter reference using word lists",
                                        async (context, enable) => {
                                            await changeContextConfig(
                                                {
                                                    explainer: {
                                                        filter: {
                                                            reference: {
                                                                list: enable,
                                                            },
                                                        },
                                                    },
                                                },
                                                context,
                                            );
                                        },
                                    ),
                                    translate: getToggleHandlerTable(
                                        "explainer filter reference by translate without context",
                                        async (context, enable) => {
                                            await changeContextConfig(
                                                {
                                                    explainer: {
                                                        filter: {
                                                            reference: {
                                                                translate:
                                                                    enable,
                                                            },
                                                        },
                                                    },
                                                },
                                                context,
                                            );
                                        },
                                    ),
                                },
                            },
                        },
                    },
                },
            },
            serviceHost: getServiceHostCommandHandlers(),
            localWhisper: getLocalWhisperCommandHandlers(),
            dev: getToggleHandlerTable(
                "development mode",
                async (context, enable) => {
                    context.sessionContext.agentContext.developerMode = enable;
                },
            ),
            log: {
                description: "Toggle logging",
                commands: {
                    db: getToggleHandlerTable(
                        "logging",
                        async (context, enable) => {
                            context.sessionContext.agentContext.dblogging =
                                false;
                        },
                    ),
                },
            },
        },
    };
}
