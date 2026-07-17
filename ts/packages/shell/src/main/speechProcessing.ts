// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModelWithStreaming, openai } from "@typeagent/aiclient";
import registerDebug from "debug";
import { createTypeChat, loadSchema } from "typeagent";
import {
    SpeechProcessingAction,
    UserExpression,
} from "./speechProcessingSchema.js";

const debug = registerDebug("typeagent:shell:speechProcessing");

/**
 * Continuous-speech classification runs a local chat model. When the
 * configured chat provider is Copilot, the connect-only (pruned) shell has no
 * bundled Copilot native to run it, so local processing must be skipped and
 * the request left to the (future) server-side path. Reads the configured
 * provider from `process.env` (`TYPEAGENT_MODEL_PROVIDER`, populated from YAML
 * config by keys.ts) rather than the active aiclient provider, because the
 * connect-only shell never initializes the aiclient runtime config.
 */
export function isLocalSpeechProcessingSupported(): boolean {
    const provider = process.env["TYPEAGENT_MODEL_PROVIDER"]
        ?.trim()
        .toLowerCase();
    return provider !== "copilot";
}

export class SpeechProcessing {
    // Singleton
    private static instance: SpeechProcessing;
    public static getInstance(): SpeechProcessing {
        if (!SpeechProcessing.instance) {
            SpeechProcessing.instance = new SpeechProcessing();
        }
        return SpeechProcessing.instance;
    }

    private model: ChatModelWithStreaming | null = null;

    private instructions: string = `
You are a system that processes speech recognition results from an open microphone.  
Your goal is to annotate the speech recognition results and to classify the incoming strings so that a downstream component can take action when the user has a question or needs an action taken. 
Only classify statements as questions or requests if they are complete statements and actionable.
`;

    constructor() {
        const apiSettings = openai.apiSettingsFromEnv(
            openai.ModelType.Chat,
            undefined,
            "GPT_5_NANO",
        );
        this.model = openai.createChatModel(
            apiSettings,
            {
                temperature: 1.0,
                max_completion_tokens: 8196,
                response_format: { type: "json_object" },
                reasoning_effort: "low",
            },
            undefined,
            ["continuous-speech-processing"],
        );
    }

    public async processSpeech(
        speechText: string,
    ): Promise<UserExpression[] | undefined> {
        debug("Processing speech: " + speechText);

        try {
            const azoai = createTypeChat<SpeechProcessingAction>(
                this.model!,
                loadSchema(["speechProcessingSchema.ts"], import.meta.url),
                "SpeechProcessingAction",
                this.instructions,
                [],
                8196,
                30,
            );

            const response = await azoai.translate(speechText);

            if (response.success) {
                return response.data.parameters.processedText;
            } else {
                return undefined;
            }
        } catch (error) {
            debug("Error processing speech: " + error);
            return undefined;
        }
    }
}
