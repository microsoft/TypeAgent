// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DisplayType,
    DynamicDisplay,
    TemplateSchema,
} from "@typeagent/agent-sdk";
import { RequestMetrics } from "../utils/metrics.js";
import { CommandCompletionResult } from "../command/completion.js";

export type DispatcherInvokeFunctions = {
    processCommand(params: {
        command: string;
        requestId?: string | undefined;
        attachments?: string[] | undefined;
    }): Promise<RequestMetrics | undefined>;

    getDynamicDisplay(params: {
        appAgentName: string;
        type: DisplayType;
        id: string;
    }): Promise<DynamicDisplay>;
    getTemplateSchema(params: {
        templateAgentName: string;
        templateName: string;
        data: unknown;
    }): Promise<TemplateSchema>;

    getTemplateCompletion(params: {
        templateAgentName: string;
        templateName: string;
        data: unknown;
        propertyName: string;
    }): Promise<string[] | undefined>;

    getCommandCompletion(params: {
        prefix: string;
    }): Promise<CommandCompletionResult | undefined>;

    close(): Promise<void>;
};
