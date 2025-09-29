// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModelWithStreaming, openai } from "aiclient";
import registerDebug from "debug";
import { createTypeChat } from "typeagent";
import { SpeechProcessingAction, UserExpression } from "./speechProcessingSchema.js";

const debug = registerDebug("typeagent:shell:speechProcessing");


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
        this.model = openai.createChatModel(
            openai.azureApiSettingsFromEnv(
                openai.ModelType.Chat,
                undefined,
                "GPT_5_NANO",
            ), 
            {
                temperature: 1.0,
                max_completion_tokens: 8196,
                response_format: { type: "json_object"},
                reasoning_effort: "low",
            },
            undefined,
            ["continuous-speech-processing"]
        );

    }

    public async processSpeech(speechText: string): Promise<UserExpression[] | undefined> {

        debug("Processing speech: " + speechText);

        try {
            const azoai = createTypeChat<SpeechProcessingAction>(
                this.model!,
                //loadSchema(["speechProcessingSchema.ts"], import.meta.url),
                `
// An action that processes speech input and returns processed text
// Processed text has been annotated to indicate user intent.
export type SpeechProcessingAction = {
    actionName: "speechProcessingAction";
    parameters: {
        // The original, unmodified speech input
        inputText: string;
        // An XML string containing the processed text
        processedText: UserExpression[];
    }
}

export type UserExpression = {
    type: "statement" | "question" | "command" | "other";
    other_explanation?: string;
    confidence: "low" | "medium" | "high";
    complete_statement: boolean;
    text: string;
}            
                `,
                "SpeechProcessingAction",
                this.instructions,
                [],
                8196,
                30
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
    };
}