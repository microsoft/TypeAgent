// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ParameterDefinitions,
    ParsedCommandParams,
} from "@typeagent/agent-sdk";
import {
    CommandHandlerTable,
    getCommandHandler,
} from "@typeagent/agent-sdk/helpers/command";

// Parameters for a command resolved at action-dispatch time. The action
// handlers pick the command by name, so its parameter definitions aren't known
// statically the way they are inside a CommandHandler.
export type CommandParams = ParsedCommandParams<ParameterDefinitions>;

// An action's `parameters` object. Each switch case reads its own fields, and
// the value types come from that case's schema member, so this stays loose.
// Tightening it means narrowing per case in every handler, which is worth doing
// alongside making executeCommandFromHandlers apply the command's declared
// defaults (today each handler hand-copies them).
// TODO: replace with per-case narrowing once defaults are resolved centrally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ActionParams = Record<string, any>;

/** Returns `{ [key]: value }` when value is defined, `{}` otherwise. */
export function opt<T>(value: T | undefined, key: string): Record<string, T> {
    return value !== undefined ? { [key]: value } : {};
}

// Builds params for a command resolved by name, matching the shape its handler
// declares: a CommandHandlerNoParams must get `undefined`, and a handler that
// declares only `args` must not be handed a `flags` object.
export function getCommandParams(
    handlers: CommandHandlerTable,
    commands: string[],
    args: Record<string, unknown> = {},
    flags: Record<string, unknown> = {},
): CommandParams | undefined {
    const handler = getCommandHandler(handlers, commands);
    if (handler.parameters === undefined || handler.parameters === false) {
        return undefined;
    }
    return {
        args: handler.parameters.args === undefined ? undefined : args,
        flags: handler.parameters.flags === undefined ? undefined : flags,
    } as unknown as CommandParams;
}

// Reads `parameters` off an action union. Action schemas mix members that have
// no `parameters` at all with members whose `parameters` is optional, so a
// direct `action.parameters` doesn't type check and throws at runtime when the
// translator omits it. Returning `{}` for both cases lets each switch case read
// its fields and fall back to the command's default.
export function actionParams(action: { actionName: string }): ActionParams {
    return (action as { parameters?: ActionParams }).parameters ?? {};
}
