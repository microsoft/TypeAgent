// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MemoryAction =
    | UseMemoryCorpusAction
    | ImportMemoryFileAction
    | SearchMemoryAction
    | AskMemoryAction
    | ListMemoryFramesAction
    | QueryMemoryFrameAction;

export interface ListMemoryFramesAction {
    actionName: "listMemoryFrames";
}
export interface QueryMemoryFrameAction {
    actionName: "queryMemoryFrame";
    parameters: {
        // Use listMemoryFrames for admitted provider/question schemas. Built-ins include source, source.event, project.status, project.owner, project.milestone and project.risk.
        schemaId: string;
        schemaRevision: number;
        query: string;
        limit?: number;
        sourceIds?: string[];
        repository?: string;
        commit?: string;
        environment?: string;
    };
}

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
