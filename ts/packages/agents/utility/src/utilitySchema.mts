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
        // Claude model ID (default: claude-haiku-4-5-20251001)
        model?: string;
    };
};

export type ClaudeTaskAction = {
    actionName: "claudeTask";
    parameters: {
        // Goal or question for Claude to accomplish using its tools (web search, fetch, etc.)
        goal: string;
        // Parse the result as JSON and store in historyText (default: false)
        parseJson?: boolean;
        // Claude model ID (default: claude-haiku-4-5-20251001)
        model?: string;
        // Maximum agentic turns (default: 10)
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
