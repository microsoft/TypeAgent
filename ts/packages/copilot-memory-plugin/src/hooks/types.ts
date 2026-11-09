// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AgentStopInput,
    UserPromptSubmittedInput,
    UserPromptSubmittedOutput,
} from "@typeagent/agent-harness-hooks/copilot-cli";

// One router handles both prompt hooks; transformedPrompt marks the second.
// userPromptTransformed adds the expanded prompt to the submitted payload.
export type PromptHookInput =
    | UserPromptSubmittedInput
    | (UserPromptSubmittedInput & { transformedPrompt: string });

// Non-Copilot hosts may also send the response text and knowledge.
export type StopHookInput = AgentStopInput & {
    response?: string;
    knowledge?: unknown;
};

// userPromptTransformed can also replace the expanded prompt.
export type HookOutput = UserPromptSubmittedOutput & {
    modifiedTransformedPrompt?: string;
};
