// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import { openai as ai } from "aiclient";
import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../actionHandler.mjs";
import { AIModelUnavailableError } from "./types.mjs";

export interface AIModelManager {
    validateAvailability(): void;
    extractKnowledge(content: string): Promise<kpLib.KnowledgeResponse>;
}

export class StrictAIModelManager implements AIModelManager {
    private knowledgeExtractor?: kpLib.KnowledgeExtractor;

    constructor(context: SessionContext<BrowserActionContext>) {
        try {
            const apiSettings = ai.azureApiSettingsFromEnv(ai.ModelType.Chat);
            const languageModel = ai.createChatModel(apiSettings);
            this.knowledgeExtractor =
                kpLib.createKnowledgeExtractor(languageModel);
        } catch (error) {
            console.warn("AI model initialization failed:", error);
        }
    }

    validateAvailability(): void {
        if (!this.knowledgeExtractor) {
            throw new AIModelUnavailableError("content");
        }
    }

    async extractKnowledge(content: string): Promise<kpLib.KnowledgeResponse> {
        this.validateAvailability();
        const result = await this.knowledgeExtractor!.extract(content);
        return (
            result || {
                entities: [],
                topics: [],
                actions: [],
                inverseActions: [],
            }
        );
    }
}
