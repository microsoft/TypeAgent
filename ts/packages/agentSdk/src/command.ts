// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Completion types (SeparatorMode, CompletionDirection, CompletionGroups,
// getCommandCompletion): docs/architecture/completion.md — §3 Agent SDK

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

//===========================================
// Completion metadata types
//
// String-literal union types that flow through the completion pipeline
// (grammar → cache → dispatcher → shell).  Each describes one axis of
// the completion result.  See docs/architecture/completion.md for full
// semantics and merge rules.
//
// AfterWildcard and SeparatorMode are intentionally duplicated in
// actionGrammar (grammarCompletion.ts, grammarMatcher.ts) because the
// two packages have no dependency relationship.  Keep the definitions
// in sync.
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
//   "optionalSpacePunctuation" — separator accepted but not required;
//                        when present, both whitespace and Unicode
//                        punctuation are valid separators.  Produced by
//                        the grammar matcher for [spacing=optional]
//                        annotated rules, and as the resolved form of
//                        "autoSpacePunctuation" when no separator is
//                        needed between the adjacent characters.
//   "optionalSpace"         — separator accepted but not required; when
//                        present, only whitespace is treated as a
//                        separator.  Used at the command/flag level
//                        when trailing whitespace was already consumed
//                        into startIndex (no additional separator
//                        needed), and for subcommand/agent-name
//                        completions.
//   "none"             — no separator at all; menu shown immediately.
//                        Used for [spacing=none] grammars.
//   "autoSpacePunctuation" — per-item mode determined by the consumer.
//                        The consumer inspects the character pair
//                        (last input char, first completion char)
//                        and resolves each item to either
//                        "spacePunctuation" or "optionalSpacePunctuation".
//                        Used for grammar auto-spacing mode.
export type SeparatorMode =
    | "space"
    | "spacePunctuation"
    | "optionalSpacePunctuation"
    | "optionalSpace"
    | "none"
    | "autoSpacePunctuation";

// Indicates the user's editing direction, provided by the host.
//   "forward"  — the user is moving ahead (appending characters,
//                typed a separator, selected a menu item).  The backend
//                should offer completions for what follows.
//   "backward" — the user is reconsidering (e.g. backspaced).  The
//                backend should offer alternatives for the current
//                position.
export type CompletionDirection = "forward" | "backward";

// Describes how the grammar rules that produced completions at this
// position relate to wildcards.
//   "none" — no rule reached this position through a wildcard.
//   "some" — some rules used a wildcard, some didn't (mixed merge).
//   "all"  — every rule reached this position through a wildcard.
// Only "none" and "all" arise from a single rule; "some" appears
// after merging results from multiple rules or grammars.
export type AfterWildcard = "none" | "some" | "all";

export type CompletionGroup = {
    name: string; // The group name for the completion
    completions: string[]; // The list of completions in the group
    separatorMode?: SeparatorMode | undefined; // What separator is required before this group's completions. Default is "space".
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
    // completions at this offset; clients need not split on spaces
    // (which fails for CJK and other non-space-delimited scripts).
    matchedPrefixLength?: number | undefined;
    // True when the completions form a closed set — if the user types
    // something not in the list, no further completions can exist
    // beyond it.  When true and the user types something that doesn't
    // prefix-match any completion, the caller can skip re-fetching.
    // False or undefined means the parser can continue past
    // unrecognized input and find more completions.
    closedSet?: boolean | undefined;
    // True when the result would differ if queried with the opposite
    // direction.  When false, the caller can skip re-fetching on
    // direction change.  When omitted, the dispatcher will conservatively
    // assume true if matchedPrefixLength > 0 and false otherwise.
    directionSensitive?: boolean | undefined;
    // Describes how the grammar rules that produced completions at
    // this position relate to wildcards.  See AfterWildcard.
    //   "none" — no wildcard; position is structurally pinned.
    //   "some" — mixed; some rules used wildcards, some didn't.
    //   "all"  — every rule used a wildcard; position can slide.
    // When omitted, the dispatcher treats it as "none".
    afterWildcard?: AfterWildcard | undefined;
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
        direction?: CompletionDirection,
    ): Promise<CompletionGroups>;

    // Execute a resolved command.  Exception from the execution are treated as errors and displayed to the user.
    executeCommand(
        commands: string[], // path to the command descriptors
        params: ParsedCommandParams<ParameterDefinitions> | undefined,
        context: ActionContext<unknown>,
        attachments?: string[],
    ): Promise<void>;
}
