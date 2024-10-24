// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, SessionContext } from "./agentInterface.js";
import { ParameterDefinitions, ParsedCommandParams } from "./parameters.js";

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
// Command Descriptor
//===========================================
export type CommandDescriptor = {
    description: string;
    help?: string;
    parameters?: ParameterDefinitions | undefined;
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

    getCommandCompletion?(
        commands: string[], // path to the command descriptors
        params: ParsedCommandParams<ParameterDefinitions> | undefined,
        names: string[], // array of <argName> or --<flagName> or --<jsonFlagName>.
        context: SessionContext<unknown>,
    ): Promise<string[]>;

    // Execute a resolved command
    executeCommand(
        commands: string[], // path to the command descriptors
        params: ParsedCommandParams<ParameterDefinitions> | undefined,
        context: ActionContext<unknown>,
        attachments?: string[],
    ): Promise<void>;
}
