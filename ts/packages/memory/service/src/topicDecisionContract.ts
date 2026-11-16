// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    normalizeDecisionAnswers,
    type DecisionAnswer,
    type DecisionQuestion,
    type StructuredOutputJsonSchema,
} from "@typeagent/aiclient";

export type TopicChoiceQuestions = Record<
    string,
    Extract<DecisionQuestion, { type: "choice" }>
>;

export class TopicDecisionContractError extends Error {}

export function topicChoiceSchema(
    questions: TopicChoiceQuestions,
): StructuredOutputJsonSchema {
    if (!Object.keys(questions).length)
        throw new TopicDecisionContractError("Empty topic decision task");
    return {
        name: "topic_decision_answers",
        strict: true,
        schema: {
            type: "object",
            additionalProperties: false,
            required: ["answers"],
            properties: {
                answers: {
                    type: "object",
                    additionalProperties: false,
                    required: Object.keys(questions),
                    properties: Object.fromEntries(
                        Object.entries(questions).map(([id, question]) => {
                            const choices = Object.keys(question.criteria);
                            if (!choices.length)
                                throw new TopicDecisionContractError(
                                    "Empty topic decision options",
                                );
                            return [
                                id,
                                {
                                    type: "object",
                                    additionalProperties: false,
                                    required: [
                                        "type",
                                        "choice",
                                        "probabilities",
                                        "confidence",
                                    ],
                                    properties: {
                                        type: {
                                            type: "string",
                                            enum: ["choice"],
                                        },
                                        choice: {
                                            type: "string",
                                            enum: choices,
                                        },
                                        probabilities: {
                                            type: "object",
                                            additionalProperties: false,
                                            required: choices,
                                            properties: Object.fromEntries(
                                                choices.map((choice) => [
                                                    choice,
                                                    {
                                                        type: "number",
                                                        minimum: 0,
                                                        maximum: 1,
                                                    },
                                                ]),
                                            ),
                                        },
                                        confidence: {
                                            type: "number",
                                            minimum: 0,
                                            maximum: 1,
                                        },
                                    },
                                },
                            ];
                        }),
                    ),
                },
            },
        },
    };
}

export function topicDecisionRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new TopicDecisionContractError("Invalid topic decision object");
    return value as Record<string, unknown>;
}

export function parseTopicChoiceAnswers(
    response: unknown,
    questions: TopicChoiceQuestions,
): Record<string, Extract<DecisionAnswer, { type: "choice" }>> {
    const record = topicDecisionRecord(response);
    if (Object.keys(record).length !== 1 || !("answers" in record))
        throw new TopicDecisionContractError(
            "Invalid topic decision response fields",
        );
    for (const value of Object.values(topicDecisionRecord(record.answers))) {
        const answer = topicDecisionRecord(value);
        const keys = ["type", "choice", "probabilities", "confidence"];
        if (
            Object.keys(answer).length !== keys.length ||
            Object.keys(answer).some((key) => !keys.includes(key)) ||
            !("confidence" in answer) ||
            typeof answer.confidence !== "number"
        )
            throw new TopicDecisionContractError(
                "Invalid topic decision answer fields",
            );
    }
    const answers = normalizeDecisionAnswers(record, questions, "azure");
    return Object.fromEntries(
        Object.entries(answers).map(([id, answer]) => {
            if (answer.type !== "choice")
                throw new TopicDecisionContractError(
                    "Topic decision requires a choice answer",
                );
            return [id, answer];
        }),
    );
}
