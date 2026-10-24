// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { success, error } from "typechat";
import type { ChatModel } from "@typeagent/aiclient";
import {
    AnswerContextChunkBuilder,
    answerContextToString,
} from "../src/answerContext.js";
import {
    AnswerGenerator,
    generateAnswer,
    generateAnswerInChunks,
    type IAnswerGenerator,
} from "../src/answerGenerator.js";
import type { AnswerContext } from "../src/answerContextSchema.js";
import type { AnswerResponse } from "../src/answerResponseSchema.js";
import { TestConversation } from "./testCommon.js";
import { TestMessage } from "./testMessage.js";

const model: ChatModel = {
    completionSettings: {},
    complete: async () => success("combined"),
};

function generator(
    fastStop = false,
): IAnswerGenerator & { visited: AnswerContext[] } {
    const visited: AnswerContext[] = [];
    return {
        visited,
        settings: {
            answerGeneratorModel: model,
            answerCombinerModel: model,
            maxCharsInBudget: 300,
            concurrency: 1,
            fastStop,
        },
        generateAnswer: async (_question, context) => {
            if (typeof context === "string")
                throw new Error("Expected chunk context");
            visited.push(context);
            return success<AnswerResponse>({
                type: "Answered",
                answer: JSON.stringify(context),
            });
        },
        combinePartialAnswers: async (_question, responses) =>
            success<AnswerResponse>({
                type: "Answered",
                answer: responses.map((response) => response.answer).join("\n"),
            }),
    };
}

describe("lossless answer context and complete traversal", () => {
    test.each([false, true])(
        "overflow preserves every ordered message; fastStop=%s",
        async (fastStop) => {
            const context = {
                messages: ["amber", "cobalt", "violet"].map((value) => ({
                    messageText: value.repeat(14),
                })),
            };
            const chunks = [
                ...new AnswerContextChunkBuilder(context, 150).getChunks(),
            ];
            expect(
                chunks
                    .flatMap((chunk) => chunk.messages ?? [])
                    .map((message) => message.messageText)
                    .join(""),
            ).toBe(
                context.messages.map((message) => message.messageText).join(""),
            );
            expect(
                chunks.every(
                    (chunk) => answerContextToString(chunk).length <= 150,
                ),
            ).toBe(true);
            const reader = generator(fastStop);
            const result = await generateAnswerInChunks(
                reader,
                "List the distinct colors",
                chunks,
            );
            expect(result.success).toBe(true);
            expect(reader.visited).toEqual(chunks);
        },
    );

    test("escaping, whitespace, source IDs, timestamps and surrogate pairs survive oversized splitting", () => {
        const text = (
            '\r\n\t"\\' +
            String.fromCodePoint(0x1f680) +
            " a  b "
        ).repeat(90);
        const chunks = [
            ...new AnswerContextChunkBuilder(
                {
                    messages: [
                        {
                            messageText: text,
                            from: "Synthetic user",
                            timestamp: new Date("2024-01-01Z"),
                            sourceMessageOrdinals: [7],
                        },
                    ],
                },
                240,
            ).getChunks(),
        ];
        expect(chunks.length).toBeGreaterThan(1);
        expect(
            chunks
                .flatMap((chunk) => chunk.messages ?? [])
                .map((message) => message.messageText)
                .join(""),
        ).toBe(text);
        for (const chunk of chunks) {
            expect(answerContextToString(chunk).length).toBeLessThanOrEqual(
                240,
            );
            expect(chunk.messages?.[0].sourceMessageOrdinals).toEqual([7]);
            const part = String(chunk.messages?.[0].messageText);
            expect(/[\uD800-\uDBFF]$/.test(part)).toBe(false);
            expect(/^[\uDC00-\uDFFF]/.test(part)).toBe(false);
        }
    });

    test("oversized knowledge and impossible metadata fail instead of disappearing", () => {
        expect(() => [
            ...new AnswerContextChunkBuilder(
                { entities: [{ knowledge: "x".repeat(200) }] },
                80,
            ).getChunks(),
        ]).toThrow(RangeError);
        expect(() => [
            ...new AnswerContextChunkBuilder(
                { messages: [{ from: "x".repeat(200), messageText: "a" }] },
                80,
            ).getChunks(),
        ]).toThrow(RangeError);
        expect(() => new AnswerContextChunkBuilder({}, 0)).toThrow(RangeError);
    });

    test.each([false, true])(
        "knowledge and message phases never duplicate mixed chunks; fastStop=%s",
        async (fastStop) => {
            const chunks: AnswerContext[] = [
                { entities: [{ knowledge: "An older observation" }] },
                { messages: [{ messageText: "First observation" }] },
                {
                    messages: [{ messageText: "Later correction" }],
                    topics: [{ knowledge: "An update" }],
                },
            ];
            const reader = generator(fastStop);
            await generateAnswerInChunks(reader, "What is current?", chunks);
            expect(reader.visited).toEqual(
                fastStop ? chunks.slice(0, 1) : chunks,
            );
        },
    );

    test("generator failures remain failures instead of partial success", async () => {
        const reader = generator();
        reader.generateAnswer = async () => error("controlled reader failure");
        const result = await generateAnswerInChunks(reader, "question", [
            { messages: [{ messageText: "first" }] },
            { messages: [{ messageText: "second" }] },
        ]);
        expect(result).toEqual(error("controlled reader failure"));
    });

    test("unchunked contexts report actual reader provenance", async () => {
        const conversation = new TestConversation(
            "synthetic",
            [],
            [new TestMessage("A retained observation")],
        );
        const reader = generator();
        reader.generateAnswer = async () =>
            success<AnswerResponse>({
                type: "Answered",
                answer: "observation",
            });
        const completed: AnswerContext[] = [];
        await generateAnswer(
            conversation,
            reader,
            "question",
            {
                messageMatches: [{ messageOrdinal: 0, score: 1 }],
                knowledgeMatches: new Map(),
            },
            (context) => {
                completed.push(context);
            },
        );
        expect(completed).toHaveLength(1);
        expect(completed[0].messages?.[0].sourceMessageOrdinals).toEqual([0]);
    });

    test("direct over-budget requests fail rather than truncating JSON or evidence", async () => {
        const reader = new AnswerGenerator(generator().settings);
        expect(
            await reader.generateAnswer("question", "x".repeat(301)),
        ).toEqual(
            error(
                "Answer context exceeds the serialized character budget; enable chunking or choose an explicit larger budget.",
            ),
        );
    });

    test("over-budget partial answers fail explicitly without cutting away a late correction", async () => {
        const reader = new AnswerGenerator(generator().settings);
        const result = await reader.combinePartialAnswers("question", [
            { type: "Answered", answer: "x".repeat(301) },
            { type: "Answered", answer: "A late correction" },
        ]);
        expect(result.success).toBe(false);
    });

    test("bounded hierarchical combination includes the final partial answer", async () => {
        const prompts: string[] = [];
        const combiner: ChatModel = {
            ...model,
            complete: async (prompt) => {
                prompts.push(JSON.stringify(prompt));
                return success(
                    JSON.stringify({
                        type: "Answered",
                        answer: "Compact merged observation.",
                    }),
                );
            },
        };
        const reader = new AnswerGenerator({
            ...generator().settings,
            answerCombinerModel: combiner,
            maxCharsInBudget: 210,
        });
        const result = await reader.combinePartialAnswers(
            "Reconcile the observations",
            ["Amber", "Cobalt", "A later Violet correction"].map((text) => ({
                type: "Answered",
                answer: text.padEnd(60, "."),
            })),
        );
        expect(result.success).toBe(true);
        expect(prompts).toHaveLength(2);
        expect(
            prompts.some((prompt) =>
                prompt.includes("A later Violet correction"),
            ),
        ).toBe(true);
    });

    test("NoAnswer facts and operands reach the structured global combiner", async () => {
        const prompts: string[] = [];
        const reader = new AnswerGenerator({
            ...generator().settings,
            maxCharsInBudget: 1000,
            answerCombinerModel: {
                ...model,
                complete: async (prompt) => {
                    prompts.push(JSON.stringify(prompt));
                    return success(
                        JSON.stringify({
                            type: "Answered",
                            answer: "$300 increase",
                        }),
                    );
                },
            },
        });
        const result = await reader.combinePartialAnswers(
            "What was the increase?",
            [
                {
                    type: "NoAnswer",
                    whyNoAnswer: "Only the earlier $2,500 price is present.",
                    supportingFacts: [
                        {
                            text: "Earlier price $2,500",
                            sourceMessageOrdinals: [1],
                        },
                    ],
                },
                {
                    type: "NoAnswer",
                    whyNoAnswer: "Only the corrected $2,800 price is present.",
                    supportingFacts: [
                        {
                            text: "Corrected price $2,800",
                            sourceMessageOrdinals: [2],
                        },
                    ],
                },
            ],
        );
        expect(result).toEqual(
            success({ type: "Answered", answer: "$300 increase" }),
        );
        expect(prompts[0]).toContain("$2,500");
        expect(prompts[0]).toContain("$2,800");
        expect(prompts[0]).toContain("sourceMessageOrdinals");
    });

    test("nonempty structured combination may still be insufficient", async () => {
        const response: AnswerResponse = {
            type: "NoAnswer",
            whyNoAnswer: "The exact price is not supported.",
            supportingFacts: [{ text: "The price is less than $300." }],
        };
        const reader = new AnswerGenerator({
            ...generator().settings,
            maxCharsInBudget: 1000,
            answerCombinerModel: {
                ...model,
                complete: async () => success(JSON.stringify(response)),
            },
        });
        expect(
            await reader.combinePartialAnswers("What exact price?", [
                { type: "Answered", answer: "At least $200" },
                { type: "NoAnswer", whyNoAnswer: "Less than $300" },
            ]),
        ).toEqual(success(response));
    });
});
