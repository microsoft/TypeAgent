// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The typed answer the explainTypeAgent handler gets back from TypeChat for
// conceptual/setup questions ("what is TypeAgent", "how do I set it up"). The
// exported types are used at compile time; `explainResponseSchemaText` mirrors
// them as source the TypeChat validator parses at runtime. Keep them in sync.

export type ExplainResponse = {
    summary: string;
    details?: string[];
    seeAlso?: ExplainPointer[];
};

export type ExplainPointer = {
    label: string;
    command?: string;
};

export const explainResponseSchemaText = `export type ExplainResponse = {
    // A direct, self-contained answer to the user's question, one to three
    // sentences. Grounded only in the provided documentation excerpts.
    summary: string;
    // Optional supporting points or ordered steps that expand on the summary.
    // Omit when the summary already answers the question.
    details?: string[];
    // Optional follow-up pointers to relevant TypeAgent commands or resources
    // (e.g. list all commands, list configured agents). Omit when none apply.
    seeAlso?: ExplainPointer[];
};

export type ExplainPointer = {
    // A short label describing where this leads (e.g. "List all commands").
    label: string;
    // The @-command to run, WITHOUT the leading '@' (e.g. "help", "config agent").
    // Omit when the pointer is not a command.
    command?: string;
};
`;
