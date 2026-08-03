// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The typed answer the Help agent gets back from TypeChat. The exported types
// are used at compile time; `commandHelpResponseSchemaText` is the same shape as
// TypeScript source the TypeChat validator parses at runtime. Keep them in sync.

export type CommandHelpResponse = {
    summary: string;
    ways: CommandHelpWay[];
};

export type CommandHelpWay = {
    host: string;
    commandPath?: string;
    actionName?: string;
    does: string;
};

export const commandHelpResponseSchemaText = `export type CommandHelpResponse = {
    // One or two sentences answering the user's question directly.
    summary: string;
    // The ways to do what the user asked, most relevant first.
    // Empty when nothing in the provided capabilities matches.
    ways: CommandHelpWay[];
};

export type CommandHelpWay = {
    // The host/agent providing this, copied exactly from the capabilities list (e.g. "system", "browser").
    host: string;
    // The @-command path within the host, WITHOUT the leading '@', copied exactly (e.g. "conversation new").
    // Omit when there is no command for this capability.
    commandPath?: string;
    // The equivalent action name, copied exactly (e.g. "newConversation"). Omit when none applies.
    actionName?: string;
    // A short description of what this does.
    does: string;
};
`;
