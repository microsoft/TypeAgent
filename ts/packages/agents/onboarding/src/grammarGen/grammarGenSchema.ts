// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Phase 4 — Grammar Generation: produce a .agr grammar file from the
// approved TypeScript schema and sample phrases, then compile and validate it.

export type GrammarGenActions =
    | GenerateGrammarAction
    | CompileGrammarAction
    | ApproveGrammarAction;

export type GenerateGrammarAction = {
    actionName: "generateGrammar";
    parameters: {
        // Integration name to generate grammar for
        integrationName: string;
    };
};

export type CompileGrammarAction = {
    actionName: "compileGrammar";
    parameters: {
        // Integration name whose grammar to compile and validate
        integrationName: string;
    };
};

export type ApproveGrammarAction = {
    actionName: "approveGrammar";
    parameters: {
        // Integration name to approve grammar for
        integrationName: string;
    };
};
