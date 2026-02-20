// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CompletionGroup,
    DisplayType,
    DynamicDisplay,
    TemplateSchema,
    TypeAgentAction,
} from "@typeagent/agent-sdk";

export type RequestId = {
    connectionId?: string | undefined;
    requestId: string;
    clientRequestId?: unknown | undefined;
};

export type Timing = {
    duration: number;
    count: number;
};

export type PhaseTiming = {
    marks?: Record<string, Timing>;
    duration?: number | undefined;
};
export type RequestMetrics = {
    parse?: PhaseTiming | undefined;
    command?: PhaseTiming | undefined;
    actions: (PhaseTiming | undefined)[];
    duration?: number | undefined;
};

// Statistics returned by the LLM completion APIs
export type CompletionUsageStats = {
    // Number of tokens in the generated completion
    completion_tokens: number;
    // Number of tokens in the prompt
    prompt_tokens: number;
    // Total tokens (prompt + completion)
    total_tokens: number;
};

export type CommandResult = {
    // last error message
    lastError?: string;

    // Actions that were executed as part of the command.
    actions?: TypeAgentAction[];
    metrics?: RequestMetrics;
    tokenUsage?: CompletionUsageStats;
};

export type CommandCompletionResult = {
    startIndex: number; // index of first character of the filter text (after the last space)
    completions: CompletionGroup[]; // completions available at the current position
};

export type AppAgentStatus = {
    emoji: string;
    name: string;
    lastUsed: boolean;
    priority: boolean;
    request: boolean;
    active: boolean;
};

export type DispatcherStatus = {
    agents: AppAgentStatus[];
    details: string;
};

export type ConnectionId = string;

/**
 * A dispatcher instance
 */
export interface Dispatcher {
    readonly connectionId: ConnectionId | undefined;

    /**
     * Process a single user request.
     *
     * @param command user request to process.  Request that starts with '@' are direct commands, otherwise they are treaded as a natural language request.
     * @param requestId an optional request id to track the command
     * @param attachments encoded image attachments for the model
     */
    processCommand(
        command: string,
        clientRequestId?: unknown,
        attachments?: string[],
    ): Promise<CommandResult | undefined>;

    /**
     * Close the dispatcher and release all resources.
     */
    close(): Promise<void>;

    /**
     * Get the latest update on a dynamic display that is returned to the host via ClientIO or CommandResult
     * @param appAgentName the agent name that originated the display
     * @param type the type of the display content.
     * @param displayId the displayId of the display content as given from ClientIO or CommandResult.
     */
    getDynamicDisplay(
        appAgentName: string,
        type: DisplayType,
        displayId: string,
    ): Promise<DynamicDisplay>;

    // APIs for form filling templates.
    getTemplateSchema(
        templateAgentName: string,
        templateName: string,
        data: unknown,
    ): Promise<TemplateSchema>;

    getTemplateCompletion(
        templateAgentName: string,
        templateName: string,
        data: unknown,
        propertyName: string,
    ): Promise<string[] | undefined>;

    // APIs to get command completion for intellisense like functionality.
    getCommandCompletion(
        prefix: string,
    ): Promise<CommandCompletionResult | undefined>;

    // Check if a request can be handled by cache without executing
    checkCache(request: string): Promise<CommandResult | undefined>;

    getStatus(): Promise<DispatcherStatus>;

    /**
     * Respond to a pending choice from an agent.
     * @param choiceId the choice ID returned from ChoiceManager.registerChoice
     * @param response boolean for yesNo, number[] of selected indices for multiChoice
     */
    respondToChoice(
        choiceId: string,
        response: boolean | number[],
    ): Promise<CommandResult | undefined>;
}
