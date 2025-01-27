// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai, TextEmbeddingModel } from "aiclient";
import { createEmbeddingCache } from "knowledge-processor";
import {
    generateEmbedding,
    indexesOfNearest,
    NormalizedEmbedding,
    SimilarityType,
    generateTextEmbeddingsWithRetry,
    collections,
    dotProduct,
} from "typeagent";
import { Term, ITermToRelatedTermsIndex } from "./dataFormat.js";

export async function buildTermSemanticIndex(
    settings: SemanticIndexSettings,
    terms: string[],
    batchSize: number,
    progressCallback?: (
        terms: string[],
        batch: collections.Slice<string>,
    ) => void,
): Promise<TermSemanticIndex> {
    const termIndex = new TermSemanticIndex(settings);
    for (const slice of collections.slices(terms, batchSize)) {
        if (progressCallback) {
            progressCallback(terms, slice);
        }
        await termIndex.push(slice.value);
    }
    return termIndex;
}

export class TermSemanticIndex implements ITermToRelatedTermsIndex {
    private termText: string[];
    private termEmbeddings: NormalizedEmbedding[];

    constructor(public settings: SemanticIndexSettings) {
        this.termText = [];
        this.termEmbeddings = [];
    }

    public async push(terms: string | string[]): Promise<void> {
        if (Array.isArray(terms)) {
            const embeddings = await generateTextEmbeddingsWithRetry(
                this.settings.embeddingModel,
                terms,
            );
            this.termText.push(...terms);
            this.termEmbeddings.push(...embeddings);
        } else {
            const embedding = await generateEmbedding(
                this.settings.embeddingModel,
                terms,
            );
            this.termText.push(terms);
            this.termEmbeddings.push(embedding);
        }
    }

    public async lookupTerm(term: string): Promise<Term[] | undefined> {
        const termEmbedding = await generateEmbedding(
            this.settings.embeddingModel,
            term,
        );
        if (this.settings.maxMatches && this.settings.maxMatches > 0) {
            const matches = indexesOfNearest(
                this.termEmbeddings,
                termEmbedding,
                this.settings.maxMatches,
                SimilarityType.Dot,
                this.settings.minScore,
            );
            return matches.map((m) => {
                return { text: this.termText[m.item], score: m.score };
            });
        } else {
            return this.indexesOfNearestTerms(
                termEmbedding,
                this.settings.minScore,
            );
        }
    }

    public remove(term: string): boolean {
        const indexOf = this.termText.indexOf(term);
        if (indexOf >= 0) {
            this.termText.splice(indexOf, 1);
            this.termEmbeddings.splice(indexOf, 1);
            return true;
        }
        return false;
    }

    private indexesOfNearestTerms(
        other: NormalizedEmbedding,
        minScore?: number,
    ): Term[] {
        minScore ??= 0;
        const matches: Term[] = [];
        for (let i = 0; i < this.termEmbeddings.length; ++i) {
            const score: number = dotProduct(this.termEmbeddings[i], other);
            if (score >= minScore) {
                matches.push({ text: this.termText[i], score });
            }
        }
        matches.sort((x, y) => y.score! - x.score!);
        return matches;
    }
}

export type SemanticIndexSettings = {
    embeddingModel: TextEmbeddingModel;
    maxMatches?: number | undefined;
    minScore?: number | undefined;
    retryMaxAttempts?: number;
    retryPauseMs?: number;
};

export function createSemanticIndexSettings(): SemanticIndexSettings {
    return {
        embeddingModel: createEmbeddingCache(openai.createEmbeddingModel(), 64),
        minScore: 0.8,
        retryMaxAttempts: 2,
        retryPauseMs: 2000,
    };
}
