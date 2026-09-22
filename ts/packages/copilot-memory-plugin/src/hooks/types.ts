// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PromptHookInput = {
    sessionId: string;
    timestamp?: number;
    cwd: string;
    prompt: string;
    transformedPrompt?: string;
};

export type StopHookInput = {
    sessionId: string;
    timestamp?: number;
    cwd: string;
    transcriptPath?: string;
    response?: string;
    knowledge?: unknown;
};

export type HookOutput = {
    additionalContext?: string;
    modifiedTransformedPrompt?: string;
};
