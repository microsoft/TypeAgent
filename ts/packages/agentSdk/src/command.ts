// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, SessionContext } from "./agentInterface.js";

export type FlagValuePrimitiveTypes = string | number | boolean;
type FlagValueLiteral<T extends FlagValuePrimitiveTypes> = T extends number
    ? "number"
    : T extends boolean
      ? "boolean"
      : "string";

type SingleFlagDefinition<T extends FlagValuePrimitiveTypes> = {
    multiple?: false;
    char?: string;
    type?: FlagValueLiteral<T>;
    default?: T;
};

type MultipleFlagDefinition<T extends FlagValuePrimitiveTypes> = {
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

export type FlagDefinitions = {
    [key: string]: FlagDefinition;
};

export type ParameterDefinitions = {
    flags: FlagDefinitions;
    args?: boolean; // TODO: add more capabilities
};

export type CommandDescriptor = {
    description: string;
    help?: string;
    parameters?: ParameterDefinitions | boolean | undefined;
};

export type CommandDescriptorTable = {
    description: string;
    commands: Record<string, CommandDescriptors>;
    defaultSubCommand?: CommandDescriptor | undefined;
};

export type CommandDescriptors = CommandDescriptor | CommandDescriptorTable;

export interface AppAgentCommandInterface {
    // Commands
    getCommands(context: SessionContext): Promise<CommandDescriptors>;

    executeCommand(
        commands: string[],
        args: string,
        context: ActionContext<unknown>,
        attachments?: string[],
    ): Promise<void>;
}
