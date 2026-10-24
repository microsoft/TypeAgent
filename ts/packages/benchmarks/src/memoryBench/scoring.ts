// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { encode } from "gpt-tokenizer/encoding/cl100k_base";
import vocabulary from "gpt-tokenizer/bpeRanks/cl100k_base";
import type { Document, Evidence, Generate, Query } from "./types.js";
import { render, type Protocol } from "./protocol.js";
import { string } from "./storage.js";

export function tokenChunks(text: string, size = 512): string[] {
    if (!Number.isInteger(size) || size < 1)
        throw new Error("Invalid token chunk size");
    const tokens = encode(text, {
        allowedSpecial: new Set(),
        disallowedSpecial: new Set(),
    });
    if (tokens.length <= size) return [text];
    const chunks: string[] = [];
    for (let start = 0; start < tokens.length; start += size)
        // Decode each chunk independently; the tokenizer's shared decoder retains partial UTF-8 bytes.
        chunks.push(
            Buffer.concat(
                tokens.slice(start, start + size).map((token) => {
                    const value = vocabulary[token];
                    if (value === undefined)
                        throw new Error(`Unknown token: ${token}`);
                    return typeof value === "string"
                        ? Buffer.from(value, "utf8")
                        : Buffer.from(value);
                }),
            ).toString("utf8"),
        );
    return chunks;
}
const words = (text: string) =>
    text.toLowerCase().trim().split(/\s+/u).filter(Boolean);
export function bm25Scores(documents: string[], query: string): number[] {
    if (!documents.length) throw new Error("No BM25 documents");
    const tokens = documents.map(words),
        average =
            tokens.reduce((sum, item) => sum + item.length, 0) / tokens.length;
    if (!average) throw new Error("Empty BM25 vocabulary");
    const counts = tokens.map((items) => {
        const result = new Map<string, number>();
        for (const word of items) result.set(word, (result.get(word) ?? 0) + 1);
        return result;
    });
    const frequencies = new Map<string, number>();
    for (const count of counts)
        for (const word of count.keys())
            frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
    const idfs = new Map(
        [...frequencies].map(([word, count]) => [
            word,
            Math.log(documents.length - count + 0.5) - Math.log(count + 0.5),
        ]),
    );
    const epsilon =
        (0.25 * [...idfs.values()].reduce((sum, value) => sum + value, 0)) /
        idfs.size;
    for (const [word, idf] of idfs) if (idf < 0) idfs.set(word, epsilon);
    return counts.map((count, index) =>
        words(query).reduce((score, word) => {
            const frequency = count.get(word) ?? 0;
            return (
                score +
                ((idfs.get(word) ?? 0) * frequency * 2.5) /
                    (frequency +
                        1.5 * (0.25 + (0.75 * tokens[index].length) / average))
            );
        }, 0),
    );
}
export function bm25Retrieve(
    documents: Document[],
    query: string,
    unit: string,
    limit = 10,
): Evidence[] {
    const chunks = documents
        .filter((doc) => doc.unit === unit)
        .flatMap((doc) =>
            tokenChunks(doc.content).map((content) => ({
                id: doc.id,
                content,
                sourceIds: doc.sourceIds,
            })),
        );
    const scores = bm25Scores(
        chunks.map((chunk) => chunk.content),
        query,
    );
    return chunks
        .map((chunk, index) => ({ chunk, index, score: scores[index] }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, limit)
        .map(({ chunk }) => chunk);
}
export function clampScore(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error("Invalid judge score");
    return value >= 0.75 ? 1 : value >= 0.25 ? 0.5 : 0;
}
export function orderingScore(reference: string[], actual: string[]) {
    const union = [...new Set([...reference, ...actual])];
    const ranks = (items: string[]) => {
        const map = new Map(items.map((item, index) => [item, index + 1]));
        return union.map((item) => map.get(item) ?? union.length + 1);
    };
    const x = ranks(reference),
        y = ranks(actual);
    let concordant = 0,
        discordant = 0,
        tieX = 0,
        tieY = 0;
    for (let i = 0; i < union.length; i++)
        for (let j = i + 1; j < union.length; j++) {
            const dx = Math.sign(x[i] - x[j]),
                dy = Math.sign(y[i] - y[j]);
            if (!dx && !dy) continue;
            if (!dx) tieX++;
            else if (!dy) tieY++;
            else if (dx === dy) concordant++;
            else discordant++;
        }
    const denominator = Math.sqrt(
        (concordant + discordant + tieX) * (concordant + discordant + tieY),
    );
    const tauNorm = denominator
        ? ((concordant - discordant) / denominator + 1) / 2
        : 0;
    const common = new Set(reference.filter((item) => actual.includes(item)))
        .size;
    const precision = actual.length ? common / actual.length : 0,
        recall = reference.length ? common / reference.length : 0;
    const f1 =
        precision + recall
            ? (2 * precision * recall) / (precision + recall)
            : 0;
    return { f1, tauNorm, finalScore: tauNorm * f1 };
}
async function align(
    reference: string[],
    answer: string,
    protocol: Protocol,
    generate: Generate,
) {
    const items = answer
        .trim()
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*(?:\d+[.)]\s*|[-*]\s*)/, "").trim())
        .filter(Boolean);
    const used = new Set<number>(),
        actual: string[] = [];
    for (const item of items) {
        let matched: number | undefined;
        for (let index = 0; index < reference.length; index++) {
            if (used.has(index)) continue;
            const value = await generate(
                render(protocol.equivalence, {
                    ref_item: reference[index],
                    sys_item: item,
                }),
                { answer: { type: "string", description: "YES or NO" } },
            );
            if (string(value.answer).trim().toUpperCase().startsWith("YES")) {
                matched = index;
                break;
            }
        }
        if (matched === undefined) actual.push(item);
        else {
            used.add(matched);
            actual.push(reference[matched]);
        }
    }
    return orderingScore(reference, actual);
}
export async function judge(
    query: Query,
    answer: string,
    protocol: Protocol,
    generate: Generate,
) {
    if (!query.rubric.length) throw new Error("Missing BEAM rubric");
    const scores: number[] = [];
    for (const item of query.rubric) {
        const rubric =
            query.category === "event_ordering" &&
            !item.toLowerCase().includes("should")
                ? `LLM response should mention: ${item}`
                : item;
        const result = await generate(
            render(protocol.rubricJudge, {
                query: query.query,
                answer,
                rubric_item: rubric,
            }),
            {
                score: {
                    type: "number",
                    description: "Score: 0.0, 0.5, or 1.0",
                },
                reason: { type: "string" },
            },
        );
        string(result.reason);
        scores.push(clampScore(result.score));
    }
    const score = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    return {
        correct: score >= 0.5,
        score,
        judgeReason: `AMB nugget score=${score.toFixed(3)}`,
        ...(query.category === "event_ordering"
            ? {
                  eventOrdering: await align(
                      query.rubric,
                      answer,
                      protocol,
                      generate,
                  ),
              }
            : {}),
    };
}
