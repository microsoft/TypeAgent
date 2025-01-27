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
} from "typeagent";
import { Term, ITermToRelatedTermsIndex } from "./dataFormat.js";

export async function buildTermSemanticIndex(
    settings: SemanticIndexSettings,
    terms: string[],
    batchSize: number,
    progressCallback?: (terms: collections.Slice<string>) => void,
): Promise<TermSemanticIndex> {
    const termIndex = new TermSemanticIndex(settings);
    for (const slice of collections.slices(terms, batchSize)) {
        if (progressCallback) {
            progressCallback(slice);
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
}

export type SemanticIndexSettings = {
    embeddingModel: TextEmbeddingModel;
    maxMatches: number;
    minScore?: number;
    retryMaxAttempts?: number;
    retryPauseMs?: number;
};

export function createSemanticIndexSettings(
    maxMatches: number,
    minScore: number,
): SemanticIndexSettings {
    return {
        embeddingModel: createEmbeddingCache(openai.createEmbeddingModel(), 64),
        maxMatches,
        minScore,
        retryMaxAttempts: 2,
        retryPauseMs: 2000,
    };
}
