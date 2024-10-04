// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, SessionContext } from "./agentInterface.js";

/*============================================================================================================
 * Dispatcher Command Extention
 *
 * AppAgentCommandInterface
 * ------------------------
 *
 * Dispatcher route `@<agentname>` commands to the agent if the `AppAgentCommandInterface` is available.
 * Dispatcher resolves the command based on the `CommandDescriptors` returned from `AppAgentCommandInterface.getCommands`.
 * Then dispatch to `AppAgentCommandInterface.executeCommand` for execution.
 *
 * The dispatcher command format is `@<agentname> [<subcommand>...] [<parameters>...]
 *
 * CommandDescriptors
 * ------------------
 * Describes commands the agent supports.
 *
 * The agent can define a single command `@<agentname>` by returning a `CommandDescriptor`.
 * Or nested subcommand by returning a `CommandDescriptorTable`. with each subcommand can have nested as well.
 *
 * Each CommandDescriptor define parameters, which includes flags (i.e. `--<flag>` or `-<alias>`) or arguments
 * Dispatcher use this information for intellisense.
 *============================================================================================================ */

//===========================================
// Parameter definitions
//===========================================
export type FlagValuePrimitiveTypes = string | number | boolean;
type FlagValueLiteral<T extends FlagValuePrimitiveTypes> = T extends number
    ? "number"
    : T extends boolean
      ? "boolean"
      : "string";

type SingleFlagDefinition<T extends FlagValuePrimitiveTypes> = {
    description?: string;
    multiple?: false;
    char?: string;
    type?: FlagValueLiteral<T>;
    default?: T;
};

type MultipleFlagDefinition<T extends FlagValuePrimitiveTypes> = {
    description?: string;
    multiple: true;
    char?: string;
    type?: FlagValueLiteral<T>;
    default?: readonly T[];
};

type FlagDefinitionT<T extends FlagValuePrimitiveTypes> = T extends boolean
    ? SingleFlagDefinition<T>
    : SingleFlagDefinition<T> | MultipleFlagDefinition<T>;

export type FullFlagDefinition = FlagDefinitionT<FlagValuePrimitiveTypes>;

// shorthand by only providing the default value, type and multiple is inferred.
type DefaultValueDefinitionT<T extends FlagValuePrimitiveTypes> =
    T extends boolean ? T : T | T[];

export type DefaultValueDefinition =
    DefaultValueDefinitionT<FlagValuePrimitiveTypes>;

export type FlagDefinition =
    | undefined // short hand for "string" flag without a default value
    | DefaultValueDefinition
    | FullFlagDefinition;

export type FlagDefinitions = Record<string, FlagDefinition>;

// Arguments
export type ArgDefinition = {
    description: string;
    type?: "string" | "number";
    optional?: boolean;
    multiple?: boolean;
};

export type ArgDefinitions = Record<string, ArgDefinition>;

export type ParameterDefinitions = {
    flags?: FlagDefinitions;
    args?: ArgDefinitions;
};

//===========================================
// Command Descriptor
//===========================================
export type CommandDescriptor = {
    description: string;
    help?: string;
    parameters?: ParameterDefinitions | boolean | undefined;
};

export type CommandDescriptorTable = {
    description: string;
    commands: Record<string, CommandDescriptors>; // The 'command' table to resolve the next '<subcommand>' in the input
    defaultSubCommand?: CommandDescriptor | undefined; // optional command to resolve to if this is the end of the command or the next '<subcommand>' doesn't match any in the 'commands' table
};

export type CommandDescriptors =
    | CommandDescriptor // single command
    | CommandDescriptorTable; // multiple commands

//===========================================
// API exposed APIs
//===========================================
export interface AppAgentCommandInterface {
    // Get the command descriptors
    getCommands(context: SessionContext): Promise<CommandDescriptors>;

    // Execute a resolved command
    executeCommand(
        commands: string[], // path to the command descriptors
        args: string,
        context: ActionContext<unknown>,
        attachments?: string[],
    ): Promise<void>;
}
