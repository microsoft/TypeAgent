// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MemoryAction =
    | UseMemoryCorpusAction
    | ImportMemoryFileAction
    | SearchMemoryAction
    | AskMemoryAction;

export interface UseMemoryCorpusAction {
    actionName: "useMemoryCorpus";
    parameters: {
        corpusId: string;
    };
}

export interface ImportMemoryFileAction {
    actionName: "importMemoryFile";
    parameters: {
        path: string;
        wait?: boolean;
    };
}

export interface SearchMemoryAction {
    actionName: "searchMemory";
    parameters: {
        query: string;
        limit?: number;
    };
}

export interface AskMemoryAction {
    actionName: "askMemory";
    parameters: {
        question: string;
        limit?: number;
    };
}
