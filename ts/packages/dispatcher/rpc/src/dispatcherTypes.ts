// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    DisplayType,
    DynamicDisplay,
    TemplateSchema,
} from "@typeagent/agent-sdk";
import type {
    CommandCompletionResult,
    CommandResult,
    DispatcherStatus,
} from "@typeagent/dispatcher-types";

export type DispatcherInvokeFunctions = {
    processCommand(
        command: string,
        clientRequestId?: unknown,
        attachments?: string[],
    ): Promise<CommandResult | undefined>;

    getDynamicDisplay(
        appAgentName: string,
        type: DisplayType,
        id: string,
    ): Promise<DynamicDisplay>;
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

    getCommandCompletion(
        prefix: string,
    ): Promise<CommandCompletionResult | undefined>;

    checkCache(request: string): Promise<CommandResult | undefined>;

    close(): Promise<void>;

    getStatus(): Promise<DispatcherStatus>;
};
