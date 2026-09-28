// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type WebSearchAction = {
    actionName: "webSearch";
    parameters: {
        // Search query text
        query: string;
        // Number of results to return (default: 5)
        numResults?: number;
    };
};

export type WebFetchAction = {
    actionName: "webFetch";
    parameters: {
        // URL to fetch
        url: string;
    };
};

export type ReadFileAction = {
    actionName: "readFile";
    parameters: {
        // Absolute or relative path to the file
        path: string;
    };
};

export type WriteFileAction = {
    actionName: "writeFile";
    parameters: {
        // Absolute or relative path to the file
        path: string;
        // Text content to write
        content: string;
    };
};

export type LlmTransformAction = {
    actionName: "llmTransform";
    parameters: {
        // Text or HTML to transform
        input: string;
        // Instructions for the transformation
        prompt: string;
        // Parse the result as JSON and store in historyText (default: false)
        parseJson?: boolean;
        // When true, LLM is asked to return HTML; result is stored in historyText as HTML (default: false)
        htmlOutput?: boolean;
        // Aiclient model endpoint (default: copilot:gpt-5.6-sol)
        model?: string;
    };
};

export type ClaudeTaskAction = {
    actionName: "claudeTask";
    parameters: {
        // Goal or question for the LLM. The action name is retained for compatibility.
        goal: string;
        // Parse the result as JSON and store in historyText (default: false)
        parseJson?: boolean;
        // Aiclient model endpoint (default: copilot:gpt-5.6-sol)
        model?: string;
        // Retained for compatibility; one-shot models ignore this value.
        maxTurns?: number;
    };
};

export type UtilityAction =
    | WebSearchAction
    | WebFetchAction
    | ReadFileAction
    | WriteFileAction
    | LlmTransformAction
    | ClaudeTaskAction;
