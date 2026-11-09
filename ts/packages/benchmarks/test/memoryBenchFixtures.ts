// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Protocol } from "../src/memoryBench/protocol.js";
import type { Host, Document } from "../src/memoryBench/types.js";
import { object, list, text } from "../src/memoryBench/storage.js";
import { beamTurns, documentsFor } from "../src/memoryBench/normalize.js";

export const protocol: Protocol = {
    ambCommit: "16fcebb0066537e890c6015c9d4a2b2eac952249",
    sourceHash: "synthetic",
    beamAnswer: "Question: {query}\nContext: {context}",
    rubricJudge: "Judge: {query} {answer} {rubric_item}",
    equivalence: "Compare: {ref_item} {sys_item}",
};
export const syntheticData = [
    {
        conversation_id: "alice",
        chat: [
            [
                {
                    role: "user",
                    id: 0,
                    time_anchor: "May-01-2024",
                    content: "Alice likes tea.",
                },
            ],
        ],
        probing_questions: {
            information_extraction: [
                {
                    question: "What does Alice like?",
                    ideal_answer: "Tea",
                    rubric: ["JUDGE_ONLY"],
                },
            ],
        },
    },
];
export function document(unit = "alice", content = "Tea"): Document {
    return documentsFor(
        unit,
        beamTurns([[{ role: "user", content, time_anchor: "May-01-2024" }]]),
    )[0];
}
export class FakeHost implements Host {
    public calls: Record<string, unknown>[] = [];
    public documents = new Map<string, Record<string, unknown>>();
    public failImport = false;
    public failJudge = false;
    public nativeMode = "synthesized";
    public answerCalls = 0;
    public closed = false;
    public async execute(request: Record<string, unknown>): Promise<unknown> {
        this.calls.push(request);
        if (this.failImport && request.operation === "ingestBatch")
            throw new Error("index failed");
        switch (request.operation) {
            case "capabilities":
                return {
                    benchmark: {
                        modelId: "synthetic-model",
                        configurationFingerprint: "fixture",
                    },
                };
            case "createCorpus":
                return { corpusId: request.name };
            case "ingestBatch":
                for (const value of list(request.documents)) {
                    const doc = object(value);
                    this.documents.set(text(doc.sourceId), {
                        ...doc,
                        corpusId: request.corpusId,
                    });
                }
                return { state: "complete" };
            case "search":
                return {
                    matches: [...this.documents]
                        .filter(([, doc]) => doc.corpusId === request.corpusId)
                        .map(([sourceId, doc]) => ({
                            sourceId,
                            snippet: doc.content,
                        })),
                };
            case "appendEvents":
                return { appended: list(request.turns).length, replayed: 0 };
            case "searchEvents":
                return { matches: [] };
            case "answer": {
                const entry = [...this.documents].find(
                    ([, doc]) => doc.corpusId === request.corpusId,
                );
                return {
                    mode: this.nativeMode,
                    answer: "Tea",
                    citations: entry
                        ? [{ sourceId: entry[0], snippet: entry[1].content }]
                        : [],
                };
            }
            case "generate": {
                const properties = object(object(request.schema).properties);
                if ("score" in properties) {
                    if (this.failJudge)
                        throw new Error("synthetic judge outage");
                    return { score: 1, reason: "synthetic" };
                }
                this.answerCalls++;
                if (text(request.prompt).includes("JUDGE_ONLY"))
                    throw new Error("Gold data leaked into answer generation");
                return { answer: "Tea" };
            }
            default:
                throw new Error(
                    `Unexpected fixture operation: ${request.operation}`,
                );
        }
    }
}
