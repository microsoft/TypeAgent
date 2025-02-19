// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections, ScoredItem } from "typeagent";
import { Term } from "./dataFormat.js";
import {
    ITextEmbeddingIndexData,
    ITermsToRelatedTermsDataItem,
    ITermToRelatedTermsData,
    ITermToRelatedTermsIndex,
    ITermsToRelatedTermsIndexData,
    ITermToRelatedTermsFuzzy,
    ITermToRelatedTerms,
    ITextEmbeddingDataItem,
} from "./secondaryIndexes.js";
import { SearchTerm } from "./search.js";
import { isSearchTermWildcard } from "./query.js";
import { TermSet } from "./collections.js";
import {
    addTextToEmbeddingIndex,
    deserializeEmbedding,
    serializeEmbedding,
    TextEditDistanceIndex,
    TextEmbeddingIndex,
    TextEmbeddingIndexSettings,
} from "./fuzzyIndex.js";

export class TermToRelatedTermsMap implements ITermToRelatedTerms {
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

export type TermsToRelatedTermIndexSettings = {
    embeddingIndexSettings: TextEmbeddingIndexSettings;
};

export class TermToRelatedTermsIndex implements ITermToRelatedTermsIndex {
    private aliasMap: TermToRelatedTermsMap;
    private editDistanceIndex: TermEditDistanceIndex | undefined;
    private embeddingIndex: TermEmbeddingIndex | undefined;

    constructor(public settings: TermsToRelatedTermIndexSettings) {
        this.aliasMap = new TermToRelatedTermsMap();
    }

    public get aliases() {
        return this.aliasMap;
    }

    public get termEditDistanceIndex() {
        return this.editDistanceIndex;
    }

    public get fuzzyIndex() {
        return this.embeddingIndex;
    }

    public serialize(): ITermsToRelatedTermsIndexData {
        return {
            aliasData: this.aliasMap.serialize(),
            textEmbeddingData: this.embeddingIndex?.serialize(),
        };
    }

    public deserialize(data?: ITermsToRelatedTermsIndexData): void {
        if (data) {
            if (data.aliasData) {
                this.aliasMap = new TermToRelatedTermsMap();
                this.aliasMap.deserialize(data.aliasData);
            }
            if (data.textEmbeddingData) {
                this.embeddingIndex = new TermEmbeddingIndex(
                    this.settings.embeddingIndexSettings,
                );
                this.embeddingIndex.deserialize(data.textEmbeddingData);
            }
        }
    }

    public buildEditDistanceIndex(terms: string[]): void {
        this.editDistanceIndex = new TermEditDistanceIndex(terms);
    }

    public async buildEmbeddingsIndex(
        terms: string[],
        batchSize: number = 8,
        progressCallback?: (batch: string[], batchStartAt: number) => boolean,
    ): Promise<void> {
        this.embeddingIndex = new TermEmbeddingIndex(
            this.settings.embeddingIndexSettings,
        );
        await this.embeddingIndex.addTermsBatched(
            terms,
            batchSize,
            progressCallback,
        );
    }
}

/**
 * Give searchTerms, resolves related terms for those searchTerms that don't already have them
 * Optionally ensures that related terms are not duplicated across search terms because this can
 * skew how semantic references are scored during search (over-counting)
 * @param relatedTermsIndex
 * @param searchTerms
 */
export async function resolveRelatedTerms(
    relatedTermsIndex: ITermToRelatedTermsIndex,
    searchTerms: SearchTerm[],
    ensureSingleOccurrence: boolean = true,
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
        if (
            relatedTermsIndex.aliases &&
            (!searchTerm.relatedTerms || searchTerm.relatedTerms.length === 0)
        ) {
            searchTerm.relatedTerms =
                relatedTermsIndex.aliases.lookupTerm(termText);
        }
        // If no hard-coded mappings, add this to the list of things for which we do fuzzy retrieval
        if (!searchTerm.relatedTerms || searchTerm.relatedTerms.length === 0) {
            searchTermsNeedingRelated.push(searchTerm);
        }
    }
    if (relatedTermsIndex.fuzzyIndex && searchTermsNeedingRelated.length > 0) {
        const relatedTermsForSearchTerms =
            await relatedTermsIndex.fuzzyIndex.lookupTerms(
                searchTermsNeedingRelated.map((st) => st.term.text),
            );
        for (let i = 0; i < searchTermsNeedingRelated.length; ++i) {
            searchTermsNeedingRelated[i].relatedTerms =
                relatedTermsForSearchTerms[i];
        }
    }
    //
    // Due to fuzzy matching, a search term may end with related terms that overlap with those of other search terms.
    // This causes scoring problems... duplicate/redundant scoring that can cause items to seem more relevant than they are
    // - The same related term can show up for different search terms but with different weights
    // - related terms may also already be present as search terms
    //
    dedupeRelatedTerms(searchTerms, ensureSingleOccurrence);
}

function dedupeRelatedTerms(
    searchTerms: SearchTerm[],
    ensureSingleOccurrence: boolean,
) {
    const allSearchTerms = new TermSet();
    let allRelatedTerms: TermSet | undefined;
    //
    // Collect all unique search and related terms.
    // We end up with {term, maximum weight for term} pairs
    //
    searchTerms.forEach((st) => allSearchTerms.add(st.term));
    if (ensureSingleOccurrence) {
        allRelatedTerms = new TermSet();
        searchTerms.forEach((st) =>
            allRelatedTerms!.addOrUnion(st.relatedTerms),
        );
    }

    for (const searchTerm of searchTerms) {
        if (searchTerm.relatedTerms && searchTerm.relatedTerms.length > 0) {
            let uniqueRelatedForSearchTerm: Term[] = [];
            for (const candidateRelatedTerm of searchTerm.relatedTerms) {
                if (allSearchTerms.has(candidateRelatedTerm)) {
                    // This related term is already a search term
                    continue;
                }
                if (ensureSingleOccurrence && allRelatedTerms) {
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
                } else {
                    uniqueRelatedForSearchTerm.push(candidateRelatedTerm);
                }
            }
            searchTerm.relatedTerms = uniqueRelatedForSearchTerm;
        }
    }
}

export interface ITermEmbeddingIndex extends ITermToRelatedTermsFuzzy {
    serialize(): ITextEmbeddingIndexData;
    deserialize(data: ITextEmbeddingIndexData): void;
}

export class TermEmbeddingIndex implements ITermEmbeddingIndex {
    private textArray: string[];
    private embeddingIndex: TextEmbeddingIndex;

    constructor(
        public settings: TextEmbeddingIndexSettings,
        data?: ITextEmbeddingIndexData,
    ) {
        this.embeddingIndex = new TextEmbeddingIndex(settings);
        this.textArray = [];
        if (data) {
            this.deserialize(data);
        }
    }

    public async addTerms(terms: string | string[]): Promise<void> {
        await this.embeddingIndex.addText(terms);
        if (Array.isArray(terms)) {
            this.textArray.push(...terms);
        } else {
            this.textArray.push(terms);
        }
    }

    public async addTermsBatched(
        terms: string[],
        batchSize: number,
        progressCallback?: (batch: string[], batchStartAt: number) => boolean,
    ): Promise<void> {
        await addTextToEmbeddingIndex(
            this.embeddingIndex,
            terms,
            batchSize,
            progressCallback,
        );
        this.textArray.push(...terms);
    }

    public async lookupTerm(
        text: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<Term[]> {
        let matches = await this.embeddingIndex.getIndexesOfNearest(
            text,
            maxMatches,
            minScore,
        );
        return this.matchesToTerms(matches);
    }

    public async lookupTerms(
        texts: string[],
        maxMatches?: number,
        minScore?: number,
    ): Promise<Term[][]> {
        const matchesList =
            await this.embeddingIndex.getIndexesOfNearestMultiple(
                texts,
                maxMatches,
                minScore,
            );
        const results: Term[][] = [];
        for (const matches of matchesList) {
            results.push(this.matchesToTerms(matches));
        }
        return results;
    }

    public deserialize(data: ITextEmbeddingIndexData): void {
        if (data.embeddingData !== undefined) {
            for (const item of data.embeddingData) {
                this.textArray.push(item.text);
                this.embeddingIndex.add(deserializeEmbedding(item.embedding));
            }
        }
    }

    public serialize(): ITextEmbeddingIndexData {
        const embeddingData: ITextEmbeddingDataItem[] = [];
        for (let i = 0; i < this.textArray.length; ++i) {
            embeddingData.push({
                text: this.textArray[i],
                embedding: serializeEmbedding(this.embeddingIndex.get(i)),
            });
        }
        return {
            embeddingData,
        };
    }

    private matchesToTerms(matches: ScoredItem[]): Term[] {
        return matches.map((m) => {
            return { text: this.textArray[m.item], weight: m.score };
        });
    }
}

export class TermEditDistanceIndex
    extends TextEditDistanceIndex
    implements ITermToRelatedTermsFuzzy
{
    constructor(textArray: string[]) {
        super(textArray);
    }

    public async lookupTerm(
        text: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<Term[]> {
        const matches = await super.getNearest(
            text,
            maxMatches,
            thresholdScore,
        );
        return this.matchesToTerms(matches);
    }

    public async lookupTerms(
        textArray: string[],
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<Term[][]> {
        const matches = await super.getNearestMultiple(
            textArray,
            maxMatches,
            thresholdScore,
        );
        return matches.map((m) => this.matchesToTerms(m));
    }

    private matchesToTerms(matches: ScoredItem<string>[]): Term[] {
        return matches.map((m) => {
            return { text: m.item, weight: m.score };
        });
    }
}
