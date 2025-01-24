// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DisplayType,
    DynamicDisplay,
    TemplateSchema,
} from "@typeagent/agent-sdk";
import { CommandCompletionResult } from "../command/completion.js";
import { CommandResult } from "../dispatcher.js";

export type DispatcherInvokeFunctions = {
    processCommand(params: {
        command: string;
        requestId?: string | undefined;
        attachments?: string[] | undefined;
    }): Promise<CommandResult | undefined>;

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
