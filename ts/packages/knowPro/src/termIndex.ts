// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai, TextEmbeddingModel } from "aiclient";
import {
    generateEmbedding,
    indexesOfNearest,
    NormalizedEmbedding,
    SimilarityType,
    generateTextEmbeddingsWithRetry,
    collections,
    dotProduct,
} from "typeagent";
import {
    Term,
    ITermEmbeddingIndex,
    ITextEmbeddingDataItem,
    ITextEmbeddingData,
} from "./dataFormat.js";
import { createEmbeddingCache } from "knowledge-processor";

export async function buildTermEmbeddingIndex(
    settings: TextEmbeddingIndexSettings,
    terms: string[],
    batchSize: number,
    progressCallback?: (
        terms: string[],
        batch: collections.Slice<string>,
    ) => boolean,
): Promise<ITermEmbeddingIndex> {
    const termIndex = new TermEmbeddingIndex(settings);
    for (const slice of collections.slices(terms, batchSize)) {
        if (progressCallback && !progressCallback(terms, slice)) {
            break;
        }
        await termIndex.add(slice.value);
    }
    return termIndex;
}

export class TermEmbeddingIndex implements ITermEmbeddingIndex {
    private termText: string[];
    private termEmbeddings: NormalizedEmbedding[];

    constructor(
        public settings: TextEmbeddingIndexSettings,
        data?: ITextEmbeddingData,
    ) {
        this.termText = [];
        this.termEmbeddings = [];
        if (data !== undefined) {
            this.deserialize(data);
        }
    }

    public async add(terms: string | string[]): Promise<void> {
        if (Array.isArray(terms)) {
            const embeddings = await generateTextEmbeddingsWithRetry(
                this.settings.embeddingModel,
                terms,
            );
            for (let i = 0; i < terms.length; ++i) {
                this.addTermEmbedding(terms[i], embeddings[i]);
            }
        } else {
            const embedding = await generateEmbedding(
                this.settings.embeddingModel,
                terms,
            );
            this.addTermEmbedding(terms, embedding);
        }
    }

    public async lookupTerm(term: string): Promise<Term[] | undefined> {
        const termEmbedding = await generateEmbedding(
            this.settings.embeddingModel,
            term,
        );
        if (
            this.settings.maxMatches !== undefined &&
            this.settings.maxMatches > 0
        ) {
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

    public deserialize(data: ITextEmbeddingData): void {
        if (data.embeddingData !== undefined) {
            for (const item of data.embeddingData) {
                this.addTermEmbedding(
                    item.text,
                    new Float32Array(item.embedding),
                );
            }
        }
    }

    public serialize(): ITextEmbeddingData {
        const embeddingData: ITextEmbeddingDataItem[] = [];
        for (let i = 0; i < this.termText.length; ++i) {
            embeddingData.push({
                text: this.termText[i],
                embedding: Array.from<number>(this.termEmbeddings[i]),
            });
        }
        return {
            embeddingData,
        };
    }

    private addTermEmbedding(term: string, embedding: NormalizedEmbedding) {
        this.termText.push(term);
        this.termEmbeddings.push(embedding);
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

export type TextEmbeddingIndexSettings = {
    embeddingModel: TextEmbeddingModel;
    minScore: number;
    maxMatches?: number | undefined;
    retryMaxAttempts?: number;
    retryPauseMs?: number;
};

export function createSemanticIndexSettings(): TextEmbeddingIndexSettings {
    return {
        embeddingModel: createEmbeddingCache(openai.createEmbeddingModel(), 64),
        minScore: 0.8,
        retryMaxAttempts: 2,
        retryPauseMs: 2000,
    };
}
