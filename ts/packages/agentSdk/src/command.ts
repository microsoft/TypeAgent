// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, SessionContext } from "./agentInterface.js";
import { ParameterDefinitions, ParsedCommandParams } from "./parameters.js";

/*============================================================================================================
 * Dispatcher Command Extension
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
    defaultSubCommand?: CommandDescriptor | string | undefined; // optional command to resolve to if this is the end of the command or the next '<subcommand>' doesn't match any in the 'commands' table
};

export type CommandDescriptors =
    | CommandDescriptor // single command
    | CommandDescriptorTable; // multiple commands

//===========================================
// Command APIs
//===========================================

// Describes what kind of separator is required between the matched prefix
// and the completion text.  The frontend uses this to decide when to show
// the completion menu.
//
//   "space"            — whitespace required (default when omitted).
//                        Used for commands, flags, agent names.
//   "spacePunctuation" — whitespace or Unicode punctuation ([\s\p{P}])
//                        required.  Used by the grammar matcher for
//                        Latin-script completions.
//   "optional"         — separator accepted but not required; menu shown
//                        immediately.  Used for CJK / mixed-script
//                        grammar completions.
//   "none"             — no separator at all; menu shown immediately.
//                        Used for [spacing=none] grammars.
export type SeparatorMode = "space" | "spacePunctuation" | "optional" | "none";

// Controls when the session considers a typed completion "committed" and
// triggers a re-fetch for the next hierarchical level.
//   "explicit" — the user must type an explicit delimiter (e.g. space or
//                punctuation) after the matched token to commit it.
//                Suppresses eager re-fetch on unique match.
//   "eager"    — commit as soon as the typed prefix uniquely satisfies a
//                completion.  Re-fetches immediately for the next level.
export type CommitMode = "explicit" | "eager";

export type CompletionGroup = {
    name: string; // The group name for the completion
    completions: string[]; // The list of completions in the group
    needQuotes?: boolean; // If true, the completion should be quoted if it has spaces.
    emojiChar?: string | undefined; // Optional icon for the completion category
    sorted?: boolean; // If true, the completions are already sorted. Default is false, and the completions sorted alphabetically.
    kind?: "literal" | "entity"; // Whether completions are fixed grammar tokens or entity values from agents
};

// Wraps an array of CompletionGroups with shared metadata that applies
// uniformly to all groups in the response.
export type CompletionGroups = {
    groups: CompletionGroup[];
    // Number of characters of the input consumed by the grammar/command parser
    // before the completion point.  When present, the shell inserts
    // completions at this offset, replacing space-based heuristics that fail
    // for CJK and other non-space-delimited scripts.
    matchedPrefixLength?: number | undefined;
    // What kind of separator is required between the matched prefix and
    // the completion text.  When omitted, defaults to "space" (whitespace
    // required before completions are shown).  See SeparatorMode.
    separatorMode?: SeparatorMode | undefined;
    // True when the completions form a closed set — if the user types
    // something not in the list, no further completions can exist
    // beyond it.  When true and the user types something that doesn't
    // prefix-match any completion, the caller can skip re-fetching.
    // False or undefined means the parser can continue past
    // unrecognized input and find more completions.
    closedSet?: boolean | undefined;
    // Controls when a uniquely-satisfied completion triggers a re-fetch
    // for the next hierarchical level.  See CommitMode.
    // When omitted, the dispatcher decides (typically "explicit" for
    // command/parameter completions).
    commitMode?: CommitMode | undefined;
};

export interface AppAgentCommandInterface {
    // Get the command descriptors
    getCommands(context: SessionContext): Promise<CommandDescriptors>;

    // Provide completion for a partial command
    getCommandCompletion?(
        commands: string[], // path to the command descriptors
        params: ParsedCommandParams<ParameterDefinitions> | undefined,
        names: string[], // array of <argName> or --<flagName> or --<jsonFlagName> for completion
        context: SessionContext<unknown>,
    ): Promise<CompletionGroups>;

    // Execute a resolved command.  Exception from the execution are treated as errors and displayed to the user.
    executeCommand(
        commands: string[], // path to the command descriptors
        params: ParsedCommandParams<ParameterDefinitions> | undefined,
        context: ActionContext<unknown>,
        attachments?: string[],
    ): Promise<void>;
}
