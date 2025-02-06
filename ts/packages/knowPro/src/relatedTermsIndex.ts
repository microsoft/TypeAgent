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
    ITextEmbeddingIndexData,
    ITermsToRelatedTermsDataItem,
    ITermToRelatedTermsData,
    ITermToRelatedTermsIndex,
    ITermsToRelatedTermsIndexData,
} from "./dataFormat.js";
import { createEmbeddingCache } from "knowledge-processor";
import { SearchTerm } from "./search.js";
import { isSearchTermWildcard } from "./query.js";

export class TermToRelatedTermsMap {
    public map: collections.MultiMap<string, Term> = new collections.MultiMap();

    constructor() {}

    public addRelatedTerm(termText: string, relatedTerm: Term | Term[]) {
        if (Array.isArray(relatedTerm)) {
            for (const related of relatedTerm) {
                this.map.addUnique(
                    termText,
                    related,
                    (x, y) => x.text === y.text,
                );
            }
        } else {
            this.map.addUnique(
                termText,
                relatedTerm,
                (x, y) => x.text === y.text,
            );
        }
    }

    public lookupTerm(term: string): Term[] | undefined {
        return this.map.get(term);
    }

    public serialize(): ITermToRelatedTermsData {
        const relatedTerms: ITermsToRelatedTermsDataItem[] = [];
        for (const [key, value] of this.map) {
            relatedTerms.push({ termText: key, relatedTerms: value });
        }
        return { relatedTerms };
    }

    public deserialize(data?: ITermToRelatedTermsData): void {
        if (data) {
            if (data.relatedTerms) {
                for (const dataItem of data.relatedTerms) {
                    this.map.set(dataItem.termText, dataItem.relatedTerms);
                }
            }
        }
    }
}

export async function resolveRelatedTerms(
    relatedTermsIndex: ITermToRelatedTermsIndex,
    searchTerms: SearchTerm[],
): Promise<void> {
    for (const searchTerm of searchTerms) {
        if (isSearchTermWildcard(searchTerm)) {
            continue;
        }
        const termText = searchTerm.term.text;
        // Resolve any specific term to related term mappings
        if (!searchTerm.relatedTerms || searchTerm.relatedTerms.length === 0) {
            searchTerm.relatedTerms = relatedTermsIndex.lookupTerm(termText);
        }
        // If no hard-coded mappings, lookup any fuzzy related terms
        // Future: do this in batch
        if (!searchTerm.relatedTerms || searchTerm.relatedTerms.length === 0) {
            searchTerm.relatedTerms =
                await relatedTermsIndex.lookupTermFuzzy(termText);
        }
    }
}

export type TermsToRelatedTermIndexSettings = {
    embeddingIndexSettings: TextEmbeddingIndexSettings;
};

export class TermToRelatedTermsIndex implements ITermToRelatedTermsIndex {
    public termAliases: TermToRelatedTermsMap;
    public termEmbeddingsIndex: ITermEmbeddingIndex | undefined;

    constructor(public settings: TermsToRelatedTermIndexSettings) {
        this.termAliases = new TermToRelatedTermsMap();
    }

    public lookupTerm(termText: string): Term[] | undefined {
        return this.termAliases.lookupTerm(termText);
    }

    public async lookupTermFuzzy(
        termText: string,
    ): Promise<Term[] | undefined> {
        if (this.termEmbeddingsIndex) {
            return await this.termEmbeddingsIndex.lookupTermsFuzzy(termText);
        }
        return undefined;
    }

    public serialize(): ITermsToRelatedTermsIndexData {
        return {
            relatedTermsData: this.termAliases.serialize(),
            textEmbeddingData: this.termEmbeddingsIndex?.serialize(),
        };
    }

    public deserialize(data?: ITermsToRelatedTermsIndexData): void {
        if (data) {
            if (data.relatedTermsData) {
                this.termAliases = new TermToRelatedTermsMap();
                this.termAliases.deserialize(data.relatedTermsData);
            }
            if (data.textEmbeddingData) {
                this.termEmbeddingsIndex = new TermEmbeddingIndex(
                    this.settings.embeddingIndexSettings,
                );
                this.termEmbeddingsIndex.deserialize(data.textEmbeddingData);
            }
        }
    }

    public async buildEmbeddingsIndex(
        terms: string[],
        batchSize: number = 8,
        progressCallback?: (
            terms: string[],
            batch: collections.Slice<string>,
        ) => boolean,
    ): Promise<void> {
        this.termEmbeddingsIndex = await buildTermEmbeddingIndex(
            this.settings.embeddingIndexSettings,
            terms,
            batchSize,
            progressCallback,
        );
    }
}

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
        data?: ITextEmbeddingIndexData,
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

    public async lookupTermsFuzzy(
        term: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<Term[] | undefined> {
        const termEmbedding = await generateEmbedding(
            this.settings.embeddingModel,
            term,
        );
        maxMatches ??= this.settings.maxMatches;
        minScore ??= this.settings.minScore;
        if (maxMatches && maxMatches > 0) {
            const matches = indexesOfNearest(
                this.termEmbeddings,
                termEmbedding,
                maxMatches,
                SimilarityType.Dot,
                minScore,
            );
            return matches.map((m) => {
                return { text: this.termText[m.item], score: m.score };
            });
        } else {
            return this.indexesOfNearestTerms(termEmbedding, minScore);
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

    public deserialize(data: ITextEmbeddingIndexData): void {
        if (data.embeddingData !== undefined) {
            for (const item of data.embeddingData) {
                this.addTermEmbedding(
                    item.text,
                    new Float32Array(item.embedding),
                );
            }
        }
    }

    public serialize(): ITextEmbeddingIndexData {
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

export function createTextEmbeddingIndexSettings(
    maxMatches = 100,
    minScore = 0.8,
): TextEmbeddingIndexSettings {
    return {
        embeddingModel: createEmbeddingCache(openai.createEmbeddingModel(), 64),
        minScore,
        retryMaxAttempts: 2,
        retryPauseMs: 2000,
    };
}
