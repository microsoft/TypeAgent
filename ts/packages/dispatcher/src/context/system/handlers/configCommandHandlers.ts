// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getToggleCommandHandlers,
    getToggleHandlerTable,
} from "../../../command/handlerUtils.js";
import {
    CommandHandlerContext,
    changeContextConfig,
} from "../../commandHandlerContext.js";
import { getAppAgentName } from "../../../translation/agentTranslators.js";
import { getServiceHostCommandHandlers } from "./serviceHost/serviceHostCommandHandler.js";

import { simpleStarRegex } from "common-utils";
import { openai as ai, getChatModelNames } from "aiclient";
import { SessionOptions } from "../../session.js";
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
import { alwaysEnabledAgents } from "../../appAgentManager.js";
import { getCacheFactory } from "../../../utils/cacheFactory.js";
import { resolveCommand } from "../../../command/command.js";
import child_process from "node:child_process";
import { fileURLToPath } from "node:url";

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

const penLauncherPath = new URL(
    "../../../../../../../dotnet/penLauncher/bin/Debug/net9.0/penLauncher.exe",
    import.meta.url,
);

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
    allowOverride: boolean = false,
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
            if (options[name] === !enable && !allowOverride) {
                throw new Error(
                    `Conflicting setting for ${existingNameType} name '${name}'`,
                );
            }
            options[name] = enable;
        }
    }
}

type StatusRecords = Record<
    string,
    { schemas?: string; actions?: string; commands?: string }
>;

type ChangedAgent = {
    schemas?: Record<string, boolean | undefined | null> | undefined | null;
    actions?: Record<string, boolean | undefined | null> | undefined | null;
    commands?: Record<string, boolean | undefined | null> | undefined | null;
};

function getDefaultStr(
    changes: ChangedAgent | undefined,
    kind: keyof ChangedAgent,
    name: string,
) {
    if (changes === undefined) {
        return "";
    }
    const change = changes[kind]?.[name];
    if (change === undefined) {
        return undefined;
    }
    return change === null ? " (default)" : "";
}

function setStatus(
    status: StatusRecords,
    kind: keyof ChangedAgent,
    name: string,
    enable: boolean | undefined | null,
    active: boolean,
    changes?: ChangedAgent,
) {
    if (enable === null) {
        return;
    }
    const defaultStr = getDefaultStr(changes, kind, name);
    if (defaultStr === undefined) {
        return;
    }
    if (status[name] === undefined) {
        status[name] = {};
        const appAgentName = getAppAgentName(name);
        if (appAgentName !== name && status[appAgentName] === undefined) {
            // Make sure we have a row for the app agent name even if it doesn't have any status for grouping
            status[appAgentName] = {};
        }
    }

    const statusChar =
        enable === undefined ? "❔" : enable ? (active ? "✅" : "💤") : "❌";
    status[name][kind] = `${statusChar}${defaultStr}`;
}

function showAgentStatus(
    toggle: AgentToggle,
    context: ActionContext<CommandHandlerContext>,
    changes?: ChangedAgent,
) {
    const systemContext = context.sessionContext.agentContext;
    const agents = systemContext.agents;

    const status: Record<
        string,
        { schemas?: string; actions?: string; commands?: string }
    > = {};

    const showSchema =
        toggle === AgentToggle.Schema || toggle === AgentToggle.Agent;
    const showAction =
        toggle === AgentToggle.Action || toggle === AgentToggle.Agent;
    const showCommand =
        toggle === AgentToggle.Command || toggle === AgentToggle.Agent;

    if (showSchema || showAction) {
        for (const name of agents.getSchemaNames()) {
            if (showSchema) {
                const state = agents.isSchemaEnabled(name);
                const active = agents.isSchemaActive(name);
                setStatus(status, "schemas", name, state, active, changes);
            }

            if (showAction) {
                const state = agents.isActionEnabled(name);
                const active = agents.isActionActive(name);
                setStatus(status, "actions", name, state, active, changes);
            }
        }
    }

    if (showCommand) {
        for (const name of agents.getAppAgentNames()) {
            const state = agents.getCommandEnabledState(name);
            setStatus(status, "commands", name, state, true, changes);
        }
    }

    const entries = Object.entries(status).sort(([a], [b]) =>
        a.localeCompare(b),
    );
    if (entries.length === 0) {
        displayWarn(changes ? "No changes" : "No agents", context);
        return;
    }

    const getRow = (
        emoji: string,
        displayName: string,
        schemas?: string,
        actions?: string,
        commands?: string,
    ) => {
        const displayEntry = [emoji, displayName];
        if (showSchema) {
            displayEntry.push(schemas ?? "");
        }
        if (showAction) {
            displayEntry.push(actions ?? "");
        }
        if (showCommand) {
            displayEntry.push(commands ?? "");
        }
        return displayEntry;
    };

    const table: string[][] = [
        getRow("", "Agent", "Schemas", "Actions", "Commands"),
    ];

    for (const [name, { schemas, actions, commands }] of entries) {
        const isAppAgentName = getAppAgentName(name) === name;
        const displayName = isAppAgentName ? name : `  ${name}`;
        const emoji = isAppAgentName ? agents.getEmojis()[name] : "";
        table.push(getRow(emoji, displayName, schemas, actions, commands));
    }

    displayResult(table, context);
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
            priority: {
                description: "priority pattern",
                multiple: true,
                char: "f",
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
        const schemaNames = agents.getSchemaNames();
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

        // reset specified agents
        let hasParams = false;
        if (params.flags.reset) {
            hasParams = true;
            for (const name of existingNames) {
                options[name] = null; // default value
            }
        }

        // if priority mode is requested we need to turn off all agents
        // and then enable just the one that we are supposed to prioritize
        if (params.flags.priority) {
            hasParams = true;

            // TODO: implement in agent config/manifests
            const priorityAgents = [
                "dispatcher",
                "system",
                "shell",
                "chat",
                "greeting",
            ];
            const priorityExclusionAgents = existingNames.filter(
                (name) => !priorityAgents.includes(name),
            );

            // disable all agents except system agents
            setAgentToggleOption(
                priorityExclusionAgents,
                existingNameType,
                options,
                ["*"],
                false,
            );

            // enable flagged agent
            setAgentToggleOption(
                existingNames,
                existingNameType,
                options,
                params.flags.priority,
                true,
                true,
            );
        }

        // turn off the agents specified by the off parameter
        if (params.flags.off) {
            hasParams = true;
            setAgentToggleOption(
                existingNames,
                existingNameType,
                options,
                params.flags.off,
                false,
            );
        }

        // turn on supplied agents by name
        if (params.args.agentNames) {
            hasParams = true;
            setAgentToggleOption(
                existingNames,
                existingNameType,
                options,
                params.args.agentNames,
                true,
            );
        }

        // report modified agent status
        if (!hasParams) {
            showAgentStatus(this.toggle, context);
            return;
        }

        const changed = await changeContextConfig(
            getAgentToggleOptions(this.toggle, options, schemaNames),
            context,
        );

        if (changed === undefined) {
            displayWarn("No change", context);
        } else {
            showAgentStatus(this.toggle, context, changed);
        }
    }

    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ) {
        const completions: string[] = [];

        for (const name of names) {
            if (name === "agentNames" || name === "--off") {
                const existingNames =
                    this.toggle === AgentToggle.Command ||
                    this.toggle === AgentToggle.Agent
                        ? context.agentContext.agents.getAppAgentNames()
                        : context.agentContext.agents.getSchemaNames();
                completions.push(...existingNames);
            }
        }

        return completions;
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
        if (changed?.explainer?.name === params.args.explainerName) {
            displayResult(
                `Explainer is set to ${params.args.explainerName}`,
                context,
            );
        } else {
            displayWarn(`Explainer is unchanged`, context);
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

class ConfigTranslationNumberOfInitialActionsCommandHandler
    implements CommandHandler
{
    public readonly description =
        "Set number of actions to use for initial translation";
    public readonly parameters = {
        args: {
            count: {
                description: "Number of actions",
                type: "number",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const count = params.args.count;
        if (count < 0) {
            throw new Error("Count must be positive integer");
        }
        await changeContextConfig(
            {
                translation: {
                    schema: {
                        optimize: {
                            numInitialActions: count,
                        },
                    },
                },
            },
            context,
        );
        displayResult(
            `Number of actions to use for initial translation is set to ${count}`,
            context,
        );
    }
}

class ConfigPortsCommandHandler implements CommandHandler {
    public readonly description = "Lists the ports assigned to agents.";

    public readonly parameters = {};

    public async run(context: ActionContext<CommandHandler>) {
        const ports: string[][] = [["", "Agent", "Port"]];
        const cmdContext = context.sessionContext.agentContext as any;
        const emojis: Record<string, string> = cmdContext.agents.getEmojis();

        cmdContext.agents.getAppAgentNames().forEach((name: string) => {
            const port = cmdContext.agents.getLocalHostPort(name);

            if (port !== undefined) {
                ports.push([
                    emojis[name],
                    name,
                    cmdContext.agents.getLocalHostPort(name)!.toString(),
                ]);
            }
        });

        displayResult(ports, context);
    }
}

class FixedSchemaCommandHandler implements CommandHandler {
    public readonly description = "Set a fixed schema disable switching";
    public readonly parameters = {
        args: {
            schemaName: {
                description: "name of the schema",
            },
        },
    };
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const schemaName = params.args.schemaName;
        const systemContext = context.sessionContext.agentContext;
        if (!systemContext.agents.isActionActive(schemaName)) {
            throw new Error(`Schema '${schemaName}' is not active.`);
        }
        await changeContextConfig(
            {
                translation: {
                    switch: {
                        embedding: false,
                        inline: false,
                        search: false,
                    },
                },
            },
            context,
        );
        context.sessionContext.agentContext.lastActionSchemaName = schemaName;
        displayResult(
            `Switching schema disabled. Schema is fixed set to '${schemaName}'`,
            context,
        );
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<ParameterDefinitions>,
        names: string[],
    ): Promise<string[]> {
        const completions: string[] = [];
        const systemContext = context.agentContext;
        for (const name of names) {
            if (name === "schemaName") {
                return systemContext.agents.getActiveSchemas();
            }
        }
        return completions;
    }
}

class HistoryLimitCommandHandler implements CommandHandler {
    public readonly description =
        "Set the limit of chat history usage in translation";
    public readonly parameters = {
        args: {
            limit: {
                description: "Number of actions",
                type: "number",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const limit = params.args.limit;
        if (limit < 0) {
            throw new Error("Limit must be positive integer");
        }
        await changeContextConfig(
            {
                translation: {
                    history: {
                        limit: limit,
                    },
                },
            },
            context,
        );
        displayResult(
            `Chat history used in translation limit is set to ${limit}`,
            context,
        );
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
        multi: {
            description: "multiple actions",
            commands: {
                ...getToggleCommandHandlers(
                    "multiple action translation",
                    async (context, enable: boolean) => {
                        await changeContextConfig(
                            { translation: { multiple: { enabled: enable } } },
                            context,
                        );
                    },
                ),
                result: getToggleHandlerTable(
                    "result id in multiple action",
                    async (context, enable: boolean) => {
                        await changeContextConfig(
                            { translation: { multiple: { result: enable } } },
                            context,
                        );
                    },
                ),
                pending: getToggleHandlerTable(
                    "pending request in multiple action",
                    async (context, enable: boolean) => {
                        await changeContextConfig(
                            { translation: { multiple: { pending: enable } } },
                            context,
                        );
                    },
                ),
            },
        },
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
                                        embedding: enable,
                                        inline: enable,
                                        search: enable,
                                    },
                                },
                            },
                            context,
                        );
                    },
                ),
                fix: new FixedSchemaCommandHandler(),
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
                    "search switch",
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
                embedding: getToggleHandlerTable(
                    "Use embedding for initial pick of schema",
                    async (context, enable: boolean) => {
                        await changeContextConfig(
                            {
                                translation: {
                                    switch: {
                                        embedding: enable,
                                    },
                                },
                            },
                            context,
                        );
                    },
                ),
            },
        },
        history: {
            description: "Configure chat history usage in translation",
            commands: {
                ...getToggleCommandHandlers(
                    "history",
                    async (context, enable: boolean) => {
                        await changeContextConfig(
                            { translation: { history: { enabled: enable } } },
                            context,
                        );
                    },
                ),
                limit: new HistoryLimitCommandHandler(),
            },
        },

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
                generation: {
                    description: "Generated action schema",
                    commands: {
                        ...getToggleCommandHandlers(
                            "generated action schema",
                            async (context, enable: boolean) => {
                                await changeContextConfig(
                                    {
                                        translation: {
                                            schema: {
                                                generation: {
                                                    enabled: enable,
                                                },
                                            },
                                        },
                                    },
                                    context,
                                );
                            },
                        ),
                        json: getToggleHandlerTable(
                            "use generate json schema if model supports it",
                            async (context, enable: boolean) => {
                                await changeContextConfig(
                                    {
                                        translation: {
                                            schema: {
                                                generation: {
                                                    jsonSchema: enable,
                                                },
                                            },
                                        },
                                    },
                                    context,
                                );
                            },
                        ),
                        jsonFunc: getToggleHandlerTable(
                            "use generate json schema function if model supports it",
                            async (context, enable: boolean) => {
                                await changeContextConfig(
                                    {
                                        translation: {
                                            schema: {
                                                generation: {
                                                    jsonSchemaFunction: enable,
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
                optimize: {
                    description: "Optimize schema",
                    commands: {
                        ...getToggleCommandHandlers(
                            "schema optimization",
                            async (context, enable) => {
                                await changeContextConfig(
                                    {
                                        translation: {
                                            schema: {
                                                optimize: {
                                                    enabled: enable,
                                                },
                                            },
                                        },
                                    },
                                    context,
                                );
                            },
                        ),
                        actions:
                            new ConfigTranslationNumberOfInitialActionsCommandHandler(),
                    },
                },
            },
        },
        entity: {
            description: "Entity translation configuration",
            commands: {
                resolve: getToggleHandlerTable(
                    "entity resolution",
                    async (context, enable) => {
                        await changeContextConfig(
                            { translation: { entity: { resolve: enable } } },
                            context,
                        );
                    },
                ),
                filter: getToggleHandlerTable(
                    "entity filter using LLM",
                    async (context, enable) => {
                        await changeContextConfig(
                            { translation: { entity: { filter: enable } } },
                            context,
                        );
                    },
                ),
                clarify: getToggleHandlerTable(
                    "entity clarification",
                    async (context, enable) => {
                        await changeContextConfig(
                            { translation: { entity: { clarify: enable } } },
                            context,
                        );
                    },
                ),
            },
        },
    },
};

async function checkRequestHandler(
    appAgentName: string,
    systemContext: CommandHandlerContext,
    throwIfFailed: boolean = true,
) {
    const result = await resolveCommand(
        `${appAgentName} request`,
        systemContext,
    );
    if (result.descriptor === undefined) {
        if (throwIfFailed) {
            throw new Error(
                `AppAgent '${appAgentName}' doesn't have request command handler`,
            );
        }
        return false;
    }

    const args = result.descriptor.parameters?.args;
    if (args === undefined) {
        if (throwIfFailed) {
            throw new Error(
                `AppAgent '${appAgentName}' request command handler doesn't accept any parameter for natural language requests`,
            );
        }
        return false;
    }

    const entries = Object.entries(args);
    if (entries.length !== 1 || entries[0][1].implicitQuotes !== true) {
        if (throwIfFailed) {
            throw new Error(
                `AppAgent '${appAgentName}' request command handler doesn't accept parameters resembling natural language requests`,
            );
        }
        return false;
    }
    return true;
}

class ConfigRequestCommandHandler implements CommandHandler {
    public readonly description =
        "Set the agent that handle natural language requests";
    public readonly parameters = {
        args: {
            appAgentName: {
                description: "name of the agent",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const appAgentName = params.args.appAgentName;
        const systemContext = context.sessionContext.agentContext;
        const current = systemContext.session.getConfig().request;
        if (current === appAgentName) {
            displayWarn(
                `Natural langue request handling agent is already set to '${appAgentName}'`,
                context,
            );
            return;
        }

        await checkRequestHandler(appAgentName, systemContext);
        await changeContextConfig({ request: appAgentName }, context);

        displayResult(
            `Natural langue request handling agent is set to '${appAgentName}'`,
            context,
        );
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        params: PartialParsedCommandParams<ParameterDefinitions>,
        names: string[],
    ): Promise<string[]> {
        const completions: string[] = [];
        const systemContext = context.agentContext;
        for (const name of names) {
            if (name === "appAgentName") {
                for (const appAgentName of systemContext.agents.getAppAgentNames()) {
                    if (
                        await checkRequestHandler(
                            appAgentName,
                            systemContext,
                            false,
                        )
                    ) {
                        completions.push(appAgentName);
                    }
                }
            }
        }
        return completions;
    }
}

export function getConfigCommandHandlers(): CommandHandlerTable {
    return {
        description: "Configuration commands",
        commands: {
            schema: new AgentToggleCommandHandler(AgentToggle.Schema),
            action: new AgentToggleCommandHandler(AgentToggle.Action),
            command: new AgentToggleCommandHandler(AgentToggle.Command),
            agent: new AgentToggleCommandHandler(AgentToggle.Agent),
            request: new ConfigRequestCommandHandler(),
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
                                        "all explanation reference filters",
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
            pen: {
                description: "Toggles click note pen handler.",
                defaultSubCommand: "on",
                commands: getToggleCommandHandlers(
                    "Surface Pen Click Handler",
                    async (isContext, enable) => {
                        if (enable) {
                            spawnPenLauncherProcess("--register");
                        } else {
                            spawnPenLauncherProcess("--unregister");
                        }
                    },
                ),
            },
            ports: new ConfigPortsCommandHandler(),
        },
    };
}

async function spawnPenLauncherProcess(args: string) {
    return new Promise<child_process.ChildProcess>((resolve, reject) => {
        const child = child_process.spawn(fileURLToPath(penLauncherPath), [
            args,
        ]);
        child.on("error", (err) => {
            reject(err);
        });
        child.on("spawn", () => {
            resolve(child);
        });
    });
}
