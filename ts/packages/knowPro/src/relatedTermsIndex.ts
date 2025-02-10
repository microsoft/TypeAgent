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
    EmbeddedValue,
    ScoredItem,
    indexesOfAllNearest,
    dotProduct,
    generateTextEmbeddings,
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
import { TermSet } from "./collections.js";

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
    const searchableTerms = new TermSet();
    const searchTermsNeedingRelated: SearchTerm[] = [];
    for (const searchTerm of searchTerms) {
        if (isSearchTermWildcard(searchTerm)) {
            continue;
        }
        searchableTerms.addOrUnion(searchTerm.term);
        const termText = searchTerm.term.text;
        // Resolve any specific term to related term mappings
        if (!searchTerm.relatedTerms || searchTerm.relatedTerms.length === 0) {
            searchTerm.relatedTerms = relatedTermsIndex.lookupTerm(termText);
        }
        // If no hard-coded mappings, lookup any fuzzy related terms
        // Future: do this in batch
        if (!searchTerm.relatedTerms || searchTerm.relatedTerms.length === 0) {
            searchTermsNeedingRelated.push(searchTerm);
        }
    }
    if (
        relatedTermsIndex.termEmbeddings &&
        searchTermsNeedingRelated.length > 0
    ) {
        const relatedTermsForSearchTerms =
            await relatedTermsIndex.termEmbeddings.lookupTerms(
                searchTermsNeedingRelated.map((st) => st.term.text),
            );
        for (let i = 0; i < searchTermsNeedingRelated.length; ++i) {
            searchTermsNeedingRelated[i].relatedTerms =
                relatedTermsForSearchTerms[i];
        }
        //
        // Due to fuzzy matching, a search term may end with related terms that overlap with those of other search terms.
        // This causes scoring problems... duplicate/redundant scoring that can cause items to seem more relevant than they are
        // - The same related term can show up for different search terms but with different weights
        // - related terms may also already be present as search terms
        //
        dedupeRelatedTerms(searchTerms);
    }
}

function dedupeRelatedTerms(searchTerms: SearchTerm[]) {
    const allSearchTerms = new TermSet();
    const allRelatedTerms = new TermSet();
    //
    // Collect all unique search and related terms.
    // We end up with {term, maximum weight for term} pairs
    //
    searchTerms.forEach((st) => {
        allSearchTerms.add(st.term);
        allRelatedTerms.addOrUnion(st.relatedTerms);
    });
    for (const searchTerm of searchTerms) {
        if (searchTerm.relatedTerms && searchTerm.relatedTerms.length > 0) {
            let uniqueRelatedForSearchTerm: Term[] = [];
            for (const candidateRelatedTerm of searchTerm.relatedTerms) {
                if (allSearchTerms.has(candidateRelatedTerm)) {
                    // This related term is already a search term
                    continue;
                }
                // Each unique related term should be searched for
                // only once, and (if there were duplicates) assigned the maximum weight assigned to that term
                const termWithMaxWeight =
                    allRelatedTerms.get(candidateRelatedTerm);
                if (
                    termWithMaxWeight !== undefined &&
                    termWithMaxWeight.weight === candidateRelatedTerm.weight
                ) {
                    // Associate this related term with the current search term
                    uniqueRelatedForSearchTerm.push(termWithMaxWeight);
                    allRelatedTerms.remove(candidateRelatedTerm);
                }
            }
            searchTerm.relatedTerms = uniqueRelatedForSearchTerm;
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

    public get termEmbeddings() {
        return this.termEmbeddingsIndex;
    }

    public lookupTerm(termText: string): Term[] | undefined {
        return this.termAliases.lookupTerm(termText);
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
                this.termEmbeddingsIndex = new TextEmbeddingIndex(
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
    const termIndex = new TextEmbeddingIndex(settings);
    for (const slice of collections.slices(terms, batchSize)) {
        if (progressCallback && !progressCallback(terms, slice)) {
            break;
        }
        await termIndex.add(slice.value);
    }
    return termIndex;
}

export class TextEmbeddingIndex implements ITermEmbeddingIndex {
    private textList: string[];
    private textEmbeddings: NormalizedEmbedding[];

    constructor(
        public settings: TextEmbeddingIndexSettings,
        data?: ITextEmbeddingIndexData,
    ) {
        this.textList = [];
        this.textEmbeddings = [];
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

    public async lookupTerm(
        text: string | NormalizedEmbedding,
        maxMatches?: number,
        minScore?: number,
    ): Promise<Term[]> {
        const termEmbedding = await generateEmbedding(
            this.settings.embeddingModel,
            text,
        );
        let matches = this.indexesOfNearestTerms(
            termEmbedding,
            maxMatches,
            minScore,
        );
        return matches.map((m) => {
            return { text: this.textList[m.item], weight: m.score };
        });
    }

    public async lookupTerms(
        texts: string[],
        maxMatches?: number,
        minScore?: number,
    ): Promise<Term[][]> {
        const termEmbeddings = await generateTextEmbeddings(
            this.settings.embeddingModel,
            texts,
        );
        const results = [];
        for (const embedding of termEmbeddings) {
            results.push(
                await this.lookupTerm(embedding, maxMatches, minScore),
            );
        }
        return results;
    }

    public async lookupEmbeddings(
        text: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<[string, NormalizedEmbedding][] | undefined> {
        const termEmbedding = await generateEmbedding(
            this.settings.embeddingModel,
            text,
        );
        let matches = this.indexesOfNearestTerms(
            termEmbedding,
            maxMatches,
            minScore,
        );
        return matches.map((m) => {
            return [this.textList[m.item], this.textEmbeddings[m.item]];
        });
    }

    public remove(term: string): boolean {
        const indexOf = this.textList.indexOf(term);
        if (indexOf >= 0) {
            this.textList.splice(indexOf, 1);
            this.textEmbeddings.splice(indexOf, 1);
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
        for (let i = 0; i < this.textList.length; ++i) {
            embeddingData.push({
                text: this.textList[i],
                embedding: Array.from<number>(this.textEmbeddings[i]),
            });
        }
        return {
            embeddingData,
        };
    }

    private addTermEmbedding(term: string, embedding: NormalizedEmbedding) {
        this.textList.push(term);
        this.textEmbeddings.push(embedding);
    }

    private indexesOfNearestTerms(
        termEmbedding: NormalizedEmbedding,
        maxMatches?: number,
        minScore?: number,
    ): ScoredItem[] {
        maxMatches ??= this.settings.maxMatches;
        minScore ??= this.settings.minScore;
        let matches: ScoredItem[];
        if (maxMatches && maxMatches > 0) {
            matches = indexesOfNearest(
                this.textEmbeddings,
                termEmbedding,
                maxMatches,
                SimilarityType.Dot,
                minScore,
            );
        } else {
            matches = indexesOfAllNearest(
                this.textEmbeddings,
                termEmbedding,
                SimilarityType.Dot,
                minScore,
            );
        }
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

export class RelatedTermSet {
    private embeddedTerms: Map<string, EmbeddedValue<Term>>;

    constructor() {
        this.embeddedTerms = new Map();
    }

    public *getTerms() {
        for (const embeddedTerm of this.embeddedTerms.values()) {
            yield embeddedTerm.value;
        }
    }

    public add(term: Term, embedding: NormalizedEmbedding) {
        this.embeddedTerms.set(term.text, { value: term, embedding });
    }

    public getSimilar(term: Term, minScore?: number): Term[] {
        minScore ??= 0;
        const similarTerms: Term[] = [];
        const testTerm = this.embeddedTerms.get(term.text);
        if (testTerm === undefined) {
            return similarTerms;
        }
        for (const embeddedTerm of this.embeddedTerms.values()) {
            const similarity = dotProduct(
                testTerm.embedding,
                embeddedTerm.embedding,
            );
            if (
                similarity >= minScore &&
                embeddedTerm.value.text !== testTerm.value.text
            ) {
                similarTerms.push(embeddedTerm.value);
            }
        }
        return similarTerms;
    }

    public removeAllSimilar(thresholdScore: number) {
        const allKeys = [...this.embeddedTerms.keys()];
        for (const key of allKeys) {
            const embeddedTerm = this.embeddedTerms.get(key);
            if (embeddedTerm !== undefined) {
                const similarTerms = this.getSimilar(
                    embeddedTerm.value,
                    thresholdScore,
                );
                if (similarTerms.length > 0) {
                    this.removeTerms(similarTerms);
                }
            }
        }
    }

    public removeTerms(terms: Term[] | IterableIterator<Term>) {
        for (const term of terms) {
            this.embeddedTerms.delete(term.text);
        }
    }
}
