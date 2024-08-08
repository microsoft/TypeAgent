// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChatTranslator, dateTime, loadSchema } from "typeagent";
import { PromptSection } from "typechat";
import { ChatModel } from "aiclient";
import { AnswerResponse } from "./answerSchema.js";
import { flatten } from "../setOperations.js";
import { SearchActionResponse, SearchResponse } from "./conversation.js";
import { GetAnswerAction, ResponseStyle } from "./knowledgeSearchSchema.js";

export interface AnswerGenerator {
    generateAnswer(
        question: string,
        action: GetAnswerAction,
        response: SearchResponse,
        higherPrecision: boolean,
    ): Promise<AnswerResponse | undefined>;
}

export type AnswerGeneratorSettings = {
    topKEntities: number;
};

export function createAnswerGenerator(
    model: ChatModel,
    settings?: AnswerGeneratorSettings,
): AnswerGenerator {
    settings ??= {
        topKEntities: 16,
    };
    const translator = createChatTranslator<AnswerResponse>(
        model,
        loadSchema(["answerSchema.ts"], import.meta.url),
        "AnswerResponse",
    );

    return {
        generateAnswer,
    };

    async function generateAnswer(
        question: string,
        action: GetAnswerAction,
        response: SearchResponse,
        higherPrecision: boolean,
    ): Promise<AnswerResponse | undefined> {
        if (returnTopicList(action, response)) {
            return generateTopicList(response);
        }

        return generateAnswerWithModel(
            question,
            response,
            action.parameters.responseStyle,
            higherPrecision,
        );
    }

    async function generateAnswerWithModel(
        question: string,
        response: SearchResponse,
        answerStyle: ResponseStyle,
        higherPrecision: boolean,
    ): Promise<AnswerResponse | undefined> {
        const hasMessages = response.messages && response.messages.length > 0;
        const context: any = {
            entities: {
                timeRanges: response.entityTimeRanges(),
                values: response.mergeAllEntities(settings!.topKEntities),
            },
            topics: {
                timeRanges: response.topicTimeRanges(),
                values: response.mergeAllTopics(),
            },
            messages:
                response.messages && response.messages.length > 0
                    ? flatten(response.messages, (m) => {
                          return {
                              timestamp: m.timestamp,
                              value: m.value.value,
                          };
                      })
                    : [],
        };
        const actions = [...response.allActions()];
        if (actions.length > 0) {
            context.actions = {
                timeRanges: response.actionTimeRanges(),
                values: actions,
            };
        }
        let prompt = `The following is a user question about a conversation:\n${question}\n\n`;
        prompt +=
            "Answer the question using only the relevant topics, entities, actions, messages and time ranges/timestamps found in CONVERSATION HISTORY.\n";
        prompt += "Entities and topics are case-insensitive\n";
        if (higherPrecision) {
            prompt +=
                "Don't answer if the topics and entity names/types in the question are not in the conversation history.\n";
        }
        if (answerStyle === "List") {
            prompt += `Your answer is a readable list that uses bullet points and newlines appropriately.`;
        } else {
            // prompt += `Your answer is a concise, readable, to the point, paragraph.`;
        }
        let contextSection: PromptSection = {
            role: "user",
            content: `[CONVERSATION HISTORY]\n${JSON.stringify(context, undefined, 1)}`,
        };
        const result = await translator.translate(prompt, [contextSection]);
        return result.success ? result.data : undefined;
    }

    function returnTopicList(
        action: GetAnswerAction,
        response: SearchResponse,
    ): boolean {
        /*
        const params = action.parameters;
        return (
            params.responseStyle === "List" &&
            params.select.length === 1 &&
            params.select[0] === "Topics" &&
            response.topics.length > 0
        );
        */
        return false;
    }

    function generateTopicList(response: SearchResponse): AnswerResponse {
        let answer = "Here is some of what we talked about:\n";
        for (const topicResponse of response.topics) {
            if (topicResponse.topics && topicResponse.topics.length > 0) {
                answer += toBulletList(topicResponse.topics);
            }
        }
        return {
            type: "Answered",
            answer,
        };
    }

    function toBulletList(values: string[]): string {
        let text = "";
        for (const value of values) {
            text += "• " + value + "\n";
        }
        return text;
    }
}
