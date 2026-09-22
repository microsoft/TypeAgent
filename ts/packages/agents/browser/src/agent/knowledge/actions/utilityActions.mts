// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../browserActions.mjs";

export async function checkAIModelStatus(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    available: boolean;
    version?: string;
    endpoint?: string;
    error?: string;
}> {
    const memoryService = context.agentContext.browserMemoryService;
    if (memoryService === undefined) {
        throw new Error("Durable browser memory is not available");
    }
    const capabilities = await memoryService.getCapabilities();
    return {
        available: capabilities.features.knowledgeExtraction,
        ...(capabilities.chatProvider === undefined
            ? {}
            : { version: capabilities.chatProvider }),
        endpoint: "durable-memory-service",
        ...(capabilities.warnings.length === 0
            ? {}
            : { error: capabilities.warnings.join("; ") }),
    };
}

export async function checkActionDetectionStatus(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    available: boolean;
    capabilities?: any;
    error?: string;
}> {
    const memoryService = context.agentContext.browserMemoryService;
    if (memoryService === undefined) {
        throw new Error("Durable browser memory is not available");
    }
    const capabilities = await memoryService.getCapabilities();
    return {
        available: false,
        capabilities: {
            supportedActions: [],
            extractionModes: capabilities.features.knowledgeExtraction
                ? ["content", "full"]
                : [],
        },
        error: "Action detection is not part of durable memory knowledge extraction",
    };
}
