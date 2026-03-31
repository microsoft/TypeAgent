// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Static type declarations for the taskFlow script sandbox environment.
// This file is read at runtime by the script validator to type-check
// generated TypeScript scripts. Only the types declared here (plus a
// per-flow FlowParams interface) are available inside scripts.

interface ActionStepResult {
    text: string;
    data: unknown;
    error?: string;
}

interface TaskFlowScriptAPI {
    callAction(
        schemaName: string,
        actionName: string,
        params: Record<string, unknown>,
    ): Promise<ActionStepResult>;

    queryLLM(
        prompt: string,
        options?: { input?: string; parseJson?: boolean; model?: string },
    ): Promise<ActionStepResult>;

    webSearch(query: string): Promise<ActionStepResult>;

    webFetch(url: string): Promise<ActionStepResult>;
}

interface TaskFlowScriptResult {
    success: boolean;
    message?: string;
    data?: unknown;
    error?: string;
}

declare const api: Readonly<TaskFlowScriptAPI>;
declare const params: Readonly<FlowParams>;
declare const console: {
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
};
