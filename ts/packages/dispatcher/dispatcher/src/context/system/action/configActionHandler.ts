// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { ConfigAction } from "../schema/configActionSchema.js";
import {
    AppAction,
    ActionContext,
    ActionResult,
    FlagDefinitions,
} from "@typeagent/agent-sdk";
import {
    CommandHandlerTable,
    executeCommandFromHandlers,
    getCommandHandler,
    getFlagType,
} from "@typeagent/agent-sdk/helpers/command";
import { CommandParams } from "./actionParams.js";

type RunConfigCommandAction = ConfigAction & {
    actionName: "runConfigCommand";
};

type ConfigActionDependencies = {
    handlers?: CommandHandlerTable;
    executeCommand?: typeof executeCommandFromHandlers;
};

function parseConfigValue(
    value: string | boolean,
    type: "string" | "number" | "boolean" | "json",
    name: string,
): unknown {
    if (type === "string") {
        if (typeof value !== "string") {
            throw new Error(`Config parameter '${name}' expects a string.`);
        }
        return value;
    }
    if (type === "boolean") {
        if (typeof value === "boolean") {
            return value;
        }
        if (value === "true" || value === "1") {
            return true;
        }
        if (value === "false" || value === "0") {
            return false;
        }
        throw new Error(`Config parameter '${name}' expects a boolean.`);
    }
    if (typeof value !== "string") {
        throw new Error(`Config parameter '${name}' expects a ${type}.`);
    }
    if (type === "number") {
        const parsed = parseInt(value);
        if (parsed.toString() !== value) {
            throw new Error(`Config parameter '${name}' expects a number.`);
        }
        return parsed;
    }
    const parsed = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") {
        throw new Error(`Config parameter '${name}' expects a JSON object.`);
    }
    return parsed;
}

function parseConfigArgs(
    command: string,
    args: string[],
    argDefs: Record<
        string,
        { type?: string; multiple?: boolean; optional?: boolean }
    >,
): Record<string, unknown> {
    const parsedArgs: Record<string, unknown> = {};
    let argumentIndex = 0;
    for (const [name, definition] of Object.entries(argDefs)) {
        const type = (definition.type ?? "string") as
            | "string"
            | "number"
            | "boolean"
            | "json";
        if (definition.multiple) {
            const values = args.slice(argumentIndex);
            if (values.length === 0 && !definition.optional) {
                throw new Error(`Missing argument '${name}'.`);
            }
            if (values.length > 0) {
                parsedArgs[name] = values.map((value) =>
                    parseConfigValue(value, type, name),
                );
            }
            argumentIndex = args.length;
            continue;
        }
        const value = args[argumentIndex];
        if (value === undefined) {
            if (!definition.optional) {
                throw new Error(`Missing argument '${name}'.`);
            }
            continue;
        }
        parsedArgs[name] = parseConfigValue(value, type, name);
        argumentIndex++;
    }
    if (argumentIndex !== args.length) {
        throw new Error(`Too many arguments for config command '${command}'.`);
    }
    return parsedArgs;
}

function parseConfigFlags(
    command: string,
    suppliedFlags: Record<string, unknown>,
    flagDefs: Record<string, { multiple?: boolean; default?: unknown }>,
): Record<string, unknown> {
    for (const [name, value] of Object.entries(suppliedFlags)) {
        if (value !== undefined && flagDefs[name] === undefined) {
            throw new Error(
                `Config command '${command}' does not accept flag '${name}'.`,
            );
        }
    }
    const parsedFlags: Record<string, unknown> = {};
    for (const [name, definition] of Object.entries(flagDefs)) {
        const value = suppliedFlags[name];
        const type = getFlagType(definition as FlagDefinitions[string]) as
            | "string"
            | "number"
            | "boolean"
            | "json";
        if (value === undefined) {
            if (definition.default !== undefined) {
                parsedFlags[name] = structuredClone(definition.default);
            }
            continue;
        }
        if (definition.multiple) {
            if (!Array.isArray(value)) {
                throw new Error(`Config flag '${name}' expects an array.`);
            }
            parsedFlags[name] = value.map((item: string | boolean) =>
                parseConfigValue(item, type, name),
            );
        } else {
            if (Array.isArray(value)) {
                throw new Error(`Config flag '${name}' is not repeatable.`);
            }
            parsedFlags[name] = parseConfigValue(
                value as string | boolean,
                type,
                name,
            );
        }
    }
    return parsedFlags;
}

function getConfigCommandParams(
    action: RunConfigCommandAction,
    handlers: CommandHandlerTable,
): CommandParams | undefined {
    const { command, arguments: args = [], flags } = action.parameters;
    const handler = getCommandHandler(handlers, command.split(" "));
    if (handler.parameters === undefined || handler.parameters === false) {
        const hasFlagValue =
            flags !== undefined &&
            Object.values(flags).some((value) => value !== undefined);
        if (args.length > 0 || hasFlagValue) {
            throw new Error(`Config command '${command}' takes no parameters.`);
        }
        return undefined;
    }

    const parsedArgs = parseConfigArgs(
        command,
        args,
        (handler.parameters.args ?? {}) as Record<
            string,
            { type?: string; multiple?: boolean; optional?: boolean }
        >,
    );
    const parsedFlags = parseConfigFlags(
        command,
        (flags ?? {}) as Record<string, unknown>,
        (handler.parameters.flags ?? {}) as Record<
            string,
            { multiple?: boolean; default?: unknown }
        >,
    );

    return {
        args: handler.parameters.args === undefined ? undefined : parsedArgs,
        flags: handler.parameters.flags === undefined ? undefined : parsedFlags,
    } as CommandParams;
}

function getCommandParams(
    handlers: CommandHandlerTable,
    commands: string[],
    args: Record<string, unknown>,
    flags: Record<string, unknown>,
): CommandParams | undefined {
    const handler = getCommandHandler(handlers, commands);
    if (handler.parameters === undefined || handler.parameters === false) {
        return undefined;
    }
    return {
        args: handler.parameters.args === undefined ? undefined : args,
        flags: handler.parameters.flags === undefined ? undefined : flags,
    } as CommandParams;
}

export async function executeConfigAction(
    action: AppAction,
    context: ActionContext<CommandHandlerContext>,
    dependencies: ConfigActionDependencies = {},
): Promise<ActionResult | undefined> {
    const configAction = action as unknown as ConfigAction;
    const handlers = dependencies.handlers;
    if (handlers === undefined) {
        throw new Error("Config command handlers are unavailable.");
    }
    const execute = dependencies.executeCommand ?? executeCommandFromHandlers;
    // Agent names come from the translator, so they are passed as structured
    // parameters and never interpolated into a command string. The string form
    // is re-tokenized by the command parser, so a name like "calendar --reset"
    // would resolve as the real --reset flag and wipe the user's agent
    // configuration. Going through the handler table also lets failures
    // propagate to the action caller, which processCommandNoLock swallows.
    const run = (
        commands: string[],
        args: Record<string, unknown> = {},
        flags: Record<string, unknown> = {},
    ) =>
        execute(
            handlers,
            commands,
            getCommandParams(handlers, commands, args, flags),
            context,
        );

    switch (configAction.actionName) {
        case "listAgents":
            return run(["agent"]);

        case "toggleAgent": {
            const { enable, agentNames } = configAction.parameters;
            return enable
                ? run(["agent"], { agentNames })
                : run(["agent"], {}, { off: agentNames });
        }

        case "toggleExplanation":
            return run([
                "explainer",
                configAction.parameters.enable ? "on" : "off",
            ]);

        case "toggleDeveloperMode":
            return run(["dev", configAction.parameters.enable ? "on" : "off"]);

        case "enterAgentPriorityMode":
            return run(
                ["agent"],
                {},
                { priority: [configAction.parameters.agentName] },
            );

        case "exitAgentPriorityMode":
            return run(["agent"], {}, { reset: true });

        case "runConfigCommand":
            return execute(
                handlers,
                configAction.parameters.command.split(" "),
                getConfigCommandParams(configAction, handlers),
                context,
            );

        default:
            throw new Error(`Invalid action name: ${action.actionName}`);
    }
}
