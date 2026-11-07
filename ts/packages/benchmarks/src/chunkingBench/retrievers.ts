// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import {
    countEmbeddingTokens,
    embeddingModelForRole,
    resolveEmbeddingModel,
    validateEmbeddingVector,
    type TextEmbeddingModel,
} from "@typeagent/aiclient";
import { createBenchmarkEmbeddingModel } from "@typeagent/memory-service/benchmark";
import { createBm25Scorer } from "../memoryBench/scoring.js";
import { bytesHash } from "../memoryBench/storage.js";
import { candidateText } from "./scoring.js";
import { validateSpan } from "./datasets.js";
import { MappingError, type Candidate, type Document } from "./types.js";

export function rank(candidates: Candidate[], scores: number[]): Candidate[] {
    if (
        candidates.length !== scores.length ||
        scores.some((score) => !Number.isFinite(score))
    )
        throw new Error("Invalid ranking scores");
    return candidates
        .map((candidate, index) => ({ ...candidate, score: scores[index] }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, "en"));
}

export function lexicalRetriever(
    candidates: Candidate[],
    documents: ReadonlyMap<string, Document>,
) {
    const score = createBm25Scorer(
        candidates.map((candidate) => candidateText(candidate, documents)),
    );
    return (query: string) => rank(candidates, score(query));
}

export function reciprocalRankFusion(
    rankings: Candidate[][],
    limit: number,
    constant = 60,
): Candidate[] {
    if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        !Number.isFinite(constant) ||
        constant < 0
    )
        throw new Error("Invalid fusion limits");
    const items = new Map<string, Candidate>();
    for (const ranking of rankings) {
        const seen = new Set<string>();
        ranking.slice(0, limit).forEach((candidate, index) => {
            if (seen.has(candidate.id))
                throw new Error("Duplicate candidate in fusion ranking");
            seen.add(candidate.id);
            const previous = items.get(candidate.id);
            if (
                previous &&
                (previous.documentId !== candidate.documentId ||
                    previous.start !== candidate.start ||
                    previous.end !== candidate.end ||
                    previous.header !== candidate.header)
            )
                throw new Error("Fusion candidate identity collision");
            items.set(candidate.id, {
                ...candidate,
                score: (previous?.score ?? 0) + 1 / (constant + index + 1),
            });
        });
    }
    return [...items.values()].sort(
        (a, b) => b.score - a.score || a.id.localeCompare(b.id, "en"),
    );
}

export const sourceMapSchema = z.object({
    sourceId: z.string(),
    revisionId: z.string(),
    contentHash: z.string(),
    totalChars: z.number().int().nonnegative(),
    blocks: z.array(
        z.object({
            start: z.number().int().nonnegative(),
            end: z.number().int().positive(),
            sha256: z.string(),
        }),
    ),
});
export type SourceMap = z.infer<typeof sourceMapSchema>;

export function nativeCandidate(
    value: unknown,
    document: Document,
    source: SourceMap,
): Candidate {
    const parsed = z
        .object({
            sourceId: z.string(),
            revisionId: z.string(),
            snippet: z.string().min(1),
            locator: z.string(),
            score: z.number().finite(),
        })
        .safeParse(value);
    if (!parsed.success)
        throw new MappingError(
            `Malformed native evidence: ${parsed.error.message}`,
        );
    const match = parsed.data;
    if (
        match.sourceId !== source.sourceId ||
        match.revisionId !== source.revisionId ||
        source.totalChars !== document.text.length ||
        source.contentHash !== bytesHash(document.text)
    )
        throw new MappingError(
            "Source/revision fingerprint does not match corpus",
        );
    const anchor = /^indexed:(\d+):([a-f0-9]{64}):(\d+)-(\d+)$/u.exec(
        match.locator,
    );
    const chars = /^chars:(\d+)-(\d+)$/u.exec(match.locator);
    let start: number, end: number;
    if (chars) {
        start = Number(chars[1]);
        end = Number(chars[2]);
    } else if (anchor) {
        const block = source.blocks[Number(anchor[1])];
        const from = Number(anchor[3]),
            to = Number(anchor[4]);
        if (
            !block ||
            block.sha256 !== anchor[2] ||
            from < 0 ||
            to <= from ||
            to > block.end - block.start
        )
            throw new MappingError("Invalid indexed block anchor");
        start = block.start + from;
        end = block.start + to;
    } else {
        if (!/^message:\d+$/u.test(match.locator))
            throw new MappingError("Unsupported native locator");
        const blocks = source.blocks.filter(
            (block) =>
                document.text.slice(block.start, block.end) === match.snippet,
        );
        if (blocks.length !== 1)
            throw new MappingError(
                "Ordinary message has an ambiguous or missing source block",
            );
        ({ start, end } = blocks[0]);
    }
    if (document.text.slice(start, end) !== match.snippet)
        throw new MappingError(
            "Retrieved snippet does not match its exact source range",
        );
    try {
        validateSpan(
            { documentId: document.id, start, end },
            new Map([[document.id, document]]),
        );
    } catch (error) {
        if (!(error instanceof Error)) throw error;
        throw new MappingError(error.message);
    }
    return {
        id: `${document.id}:${start}-${end}`,
        documentId: document.id,
        start,
        end,
        score: match.score,
        header: "",
        locator: match.locator,
        revisionId: match.revisionId,
    };
}

export async function vectorRetriever(
    candidates: Candidate[],
    documents: ReadonlyMap<string, Document>,
    inputLimit: number,
) {
    if (!Number.isSafeInteger(inputLimit) || inputLimit < 1)
        throw new Error(
            "Vector arm requires a positive declared embedding token limit",
        );
    const configured = createBenchmarkEmbeddingModel();
    if (!configured)
        throw new Error(
            "Vector arm requires an explicitly configured embedding provider",
        );
    let disposable: TextEmbeddingModel = configured;
    try {
        const model = await resolveEmbeddingModel(configured);
        disposable = model;
        const identity = model.embeddingIdentity;
        if (!identity)
            throw new Error(
                "Vector arm requires an identified embedding model",
            );
        const embed = async (value: string, role: "document" | "query") => {
            if (countEmbeddingTokens(value) > inputLimit)
                throw new Error(
                    "Embedding input exceeds declared cl100k token limit; no truncation is permitted",
                );
            const result = await embeddingModelForRole(
                model,
                role,
            ).generateEmbedding(value);
            if (!result.success) throw new Error(result.message);
            validateEmbeddingVector(result.data, identity.dimensions);
            return result.data;
        };
        const vectors: number[][] = [];
        for (const candidate of candidates)
            vectors.push(
                await embed(candidateText(candidate, documents), "document"),
            );
        return {
            identity,
            inputLimit,
            model,
            retrieve: async (query: string) => {
                const vector = await embed(query, "query");
                return rank(
                    candidates,
                    vectors.map((item) => cosine(item, vector)),
                );
            },
        };
    } catch (error) {
        await disposable.dispose?.();
        throw error;
    }
}

function cosine(left: number[], right: number[]): number {
    const norm = (value: number[]) =>
        Math.sqrt(value.reduce((sum, item) => sum + item * item, 0));
    const denominator = norm(left) * norm(right);
    if (left.length !== right.length || !denominator)
        throw new Error("Incompatible or zero embedding vectors");
    return (
        left.reduce((sum, item, index) => sum + item * right[index], 0) /
        denominator
    );
}

export async function closeVector(model: TextEmbeddingModel | undefined) {
    await model?.dispose?.();
}
