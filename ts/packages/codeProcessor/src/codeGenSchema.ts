// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeLine = string;
export type CodeComment = string;

export type Code = CodeLine | CodeComment;

export type GeneratedCode = {
    language: string;
    linesOfCode: Code[];
    // Code to test the lines of code you generated
    testCode: Code[];
};

export type GeneratedResponse = {
    type: "generated";
    code: GeneratedCode;
};

export type NotGeneratedResponse = {
    type: "notGenerated";
    reason?: string | undefined;
};

export type CodeGenResponse = GeneratedResponse | NotGeneratedResponse;
