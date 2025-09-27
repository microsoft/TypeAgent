// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../browserActions.mjs";
import {
    AIModelRequiredError,
} from "website-memory";
import { BrowserKnowledgeExtractor } from "../browserKnowledgeExtractor.mjs";


export async function checkAIModelStatus(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    available: boolean;
    version?: string;
    endpoint?: string;
    error?: string;
}> {
    try {
        const extractor = new BrowserKnowledgeExtractor(context);

        // Test AI availability with a simple extraction
        await extractor.extractKnowledge(
            {
                url: "test://ai-check",
                title: "AI Availability Test",
                textContent: "test content for AI availability check",
                source: "direct",
            },
            "content",
        );

        return {
            available: true,
            version: "available",
            endpoint: "configured",
        };
    } catch (error) {
        if (error instanceof AIModelRequiredError) {
            return {
                available: false,
                error: error.message,
            };
        }

        return {
            available: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Unknown AI model error",
        };
    }
}

export async function checkActionDetectionStatus(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    available: boolean;
    capabilities?: any;
    error?: string;
}> {
    try {
        const extractor = new BrowserKnowledgeExtractor(context);

        const capabilities = extractor.getActionDetectionCapabilities();
        const isAvailable = extractor.isActionDetectionAvailable();

        return {
            available: isAvailable,
            capabilities: capabilities,
        };
    } catch (error) {
        return {
            available: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Unknown action detection error",
        };
    }
}