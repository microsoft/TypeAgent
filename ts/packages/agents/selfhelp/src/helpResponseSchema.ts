// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The typed answer the merged help flow gets back from TypeChat. One action now
// answers any question about TypeAgent - command lookup ("what's the command for
// X"), capability checks ("can I X"), and conceptual/setup questions ("what is
// TypeAgent", "what keys do I need") - so the response is a superset: a prose
// `summary` plus optional command `ways` (rendered as cards), `details`, and
// `seeAlso` pointers. The exported types are used at compile time;
// `helpResponseSchemaText` mirrors them as source the TypeChat validator parses
// at runtime. Keep them in sync.

export type HelpResponse = {
    summary: string;
    ways?: HelpWay[];
    details?: string[];
    seeAlso?: HelpPointer[];
};

export type HelpWay = {
    host: string;
    commandPath?: string;
    actionName?: string;
    does: string;
};

export type HelpPointer = {
    label: string;
    command?: string;
};

export const helpResponseSchemaText = `export type HelpResponse = {
    // A direct, self-contained answer to the user's question, one to three
    // sentences, grounded only in the provided capabilities and documentation.
    summary: string;
    // The command(s)/action(s) that let the user DO what they asked, most
    // relevant first. Fill this when the question is about performing a task in
    // TypeAgent. Omit for purely conceptual or setup questions.
    ways?: HelpWay[];
    // Optional supporting points or ordered steps that expand on the summary
    // (e.g. which keys to set, how to configure). Grounded in the documentation
    // excerpts. Omit when the summary already answers the question.
    details?: string[];
    // Optional follow-up pointers to relevant commands/resources (e.g. list all
    // commands, list configured agents). Omit when none apply.
    seeAlso?: HelpPointer[];
};

export type HelpWay = {
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

export type HelpPointer = {
    // A short label describing where this leads (e.g. "List all commands").
    label: string;
    // The @-command to run, WITHOUT the leading '@' (e.g. "help", "config agent").
    // Omit when the pointer is not a command.
    command?: string;
};
`;
