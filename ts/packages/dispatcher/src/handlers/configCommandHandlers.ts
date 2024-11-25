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

import { simpleStarRegex } from "common-utils";
import { openai as ai, getChatModelNames } from "aiclient";
import { SessionOptions } from "../session/session.js";
import chalk from "chalk";
import {
    ActionContext,
    ParameterDefinitions,
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
    Schema,
    Action,
    Command,
    Agent,
}

const AgentToggleDescription = [
    "agent schemas",
    "agent actions",
    "agent commands",
    "agents",
] as const;

function getAgentToggleOptions(
    toggle: AgentToggle,
    options: Record<string, boolean | null>,
    schemaNames: string[],
): SessionOptions {
    switch (toggle) {
        case AgentToggle.Schema:
            for (const name of alwaysEnabledAgents.schemas) {
                delete options[name];
            }
            return { schemas: options };
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
            const schemaOptions = Object.fromEntries(
                schemaNames.map((name) => [
                    name,
                    options[getAppAgentName(name)],
                ]),
            );
            const actionOptions = { ...schemaOptions };
            for (const name of alwaysEnabledAgents.schemas) {
                delete schemaOptions[name];
            }
            for (const name of alwaysEnabledAgents.actions) {
                delete actionOptions[name];
            }
            for (const name of alwaysEnabledAgents.commands) {
                delete options[name];
            }
            return {
                schemas: schemaOptions,
                actions: actionOptions,
                commands: options,
            };
    }
}

function setAgentToggleOption(
    existingNames: string[],
    existingNameType: "agent" | "schema",
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
        const schemaNames = agents.getTranslatorNames();
        let existingNames: string[];
        let existingNameType: "agent" | "schema";
        if (
            this.toggle == AgentToggle.Command ||
            this.toggle === AgentToggle.Agent
        ) {
            existingNames = agents.getAppAgentNames();
            existingNameType = "agent";
        } else {
            existingNames = schemaNames;
            existingNameType = "schema";
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
            getAgentToggleOptions(this.toggle, options, schemaNames),
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

function getConfigModel(kind: string, model: string) {
    const settings = ai.getChatModelSettings(model);
    return `Current ${chalk.cyan(kind)} model: ${model ? model : "(default)"}\nURL:${settings.endpoint}`;
}

class ConfigModelSetCommandHandler implements CommandHandler {
    public readonly description = "Set model";
    public readonly parameters = {
        flags: {
            reset: {
                description: "Reset to default model",
                char: "r",
                type: "boolean",
                default: false,
            },
        },
        args: {
            model: {
                description: "Model name",
                optional: true,
            },
        },
    } as const;
    public constructor(private readonly kind: "translation" | "explainer") {}
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const reset = params.flags.reset;
        const model = params.args.model;
        if (reset || model === "") {
            if (model !== undefined && model !== "") {
                throw new Error("Model name is not allowed with reset option");
            }
            const config: SessionOptions = {};
            config[this.kind] = { model: "" };
            await changeContextConfig(config, context);
            displayResult(`Reset to default model for ${this.kind}`, context);
            return;
        }
        if (model === undefined) {
            const config =
                context.sessionContext.agentContext.session.getConfig();
            displayResult(
                getConfigModel(this.kind, config[this.kind].model),
                context,
            );
            return;
        }
        const modelNames = await getChatModelNames();
        if (!modelNames.includes(model)) {
            throw new Error(
                `Invalid model name: ${model}\nValid model names: ${modelNames.join(", ")}`,
            );
        } else {
            displayResult(`Model for ${this.kind} is set to ${model}`, context);
        }
        const config: SessionOptions = {};
        config[this.kind] = { model };
        await changeContextConfig(config, context);
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<ParameterDefinitions>,
        names: string[],
    ): Promise<string[]> {
        if (params.args?.model === undefined) {
            return getChatModelNames();
        }
        return [];
    }
}

const configTranslationCommandHandlers: CommandHandlerTable = {
    description: "Translation configuration",
    defaultSubCommand: "on",
    commands: {
        ...getToggleCommandHandlers("translation", async (context, enable) => {
            await changeContextConfig(
                { translation: { enabled: enable } },
                context,
            );
        }),
        model: new ConfigModelSetCommandHandler("translation"),
        multi: getToggleHandlerTable(
            "multiple action translation",
            async (context, enable: boolean) => {
                await changeContextConfig(
                    { translation: { multipleActions: enable } },
                    context,
                );
            },
        ),
        switch: {
            description: "auto switch schemas",
            commands: {
                ...getToggleCommandHandlers(
                    "switch schema",
                    async (context, enable: boolean) => {
                        await changeContextConfig(
                            {
                                translation: {
                                    switch: {
                                        inline: enable,
                                        search: enable,
                                    },
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
                                translation: {
                                    switch: {
                                        inline: enable,
                                    },
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
                                translation: {
                                    switch: {
                                        search: enable,
                                    },
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
                await changeContextConfig(
                    { translation: { history: enable } },
                    context,
                );
            },
        ),
        stream: getToggleHandlerTable(
            "streaming translation",
            async (context, enable: boolean) => {
                await changeContextConfig(
                    { translation: { stream: enable } },
                    context,
                );
            },
        ),
        schema: {
            description: "Action schema configuration",
            commands: {
                generation: getToggleHandlerTable(
                    "generated action schema",
                    async (context, enable: boolean) => {
                        await changeContextConfig(
                            {
                                translation: {
                                    schema: {
                                        generation: enable,
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
};

export function getConfigCommandHandlers(): CommandHandlerTable {
    return {
        description: "Configuration commands",
        commands: {
            schema: new AgentToggleCommandHandler(AgentToggle.Schema),
            action: new AgentToggleCommandHandler(AgentToggle.Action),
            command: new AgentToggleCommandHandler(AgentToggle.Command),
            agent: new AgentToggleCommandHandler(AgentToggle.Agent),
            translation: configTranslationCommandHandlers,
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
                    model: new ConfigModelSetCommandHandler("explainer"),
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
