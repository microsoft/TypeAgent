// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections, ScoredItem } from "typeagent";
import {
    Term,
    ITextEmbeddingIndexData,
    ITermsToRelatedTermsDataItem,
    ITermToRelatedTermsData,
    ITermToRelatedTermsIndex,
    ITermsToRelatedTermsIndexData,
    ITermToRelatedTermsFuzzy,
    ITermToRelatedTerms,
} from "./dataFormat.js";
import { SearchTerm } from "./search.js";
import { isSearchTermWildcard } from "./query.js";
import { TermSet } from "./collections.js";
import {
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

    public get termVectorIndex() {
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
        progressCallback?: (
            terms: string[],
            batch: collections.Slice<string>,
        ) => boolean,
    ): Promise<void> {
        this.embeddingIndex = await buildTermEmbeddingIndex(
            this.settings.embeddingIndexSettings,
            terms,
            batchSize,
            progressCallback,
        );
    }
}

/**
 * Give searchTerms, resolves related terms for those searchTerms that don't already have them
 * Optionally ensures that related terms are not duplicated across search terms because this can
 * skew how semantic references are scored during search
 * @param relatedTermsIndex
 * @param searchTerms
 */
export async function resolveRelatedTerms(
    relatedTermsIndex: ITermToRelatedTermsIndex,
    searchTerms: SearchTerm[],
    dedupe: boolean = true,
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
        // If no hard-coded mappings, lookup any fuzzy related terms
        // Future: do this in batch
        if (!searchTerm.relatedTerms || searchTerm.relatedTerms.length === 0) {
            searchTermsNeedingRelated.push(searchTerm);
        }
    }
    if (
        relatedTermsIndex.termVectorIndex &&
        searchTermsNeedingRelated.length > 0
    ) {
        const relatedTermsForSearchTerms =
            await relatedTermsIndex.termVectorIndex.lookupTerms(
                searchTermsNeedingRelated.map((st) => st.term.text),
            );
        for (let i = 0; i < searchTermsNeedingRelated.length; ++i) {
            searchTermsNeedingRelated[i].relatedTerms =
                relatedTermsForSearchTerms[i];
        }
    }
    if (dedupe) {
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

export async function buildTermEmbeddingIndex(
    settings: TextEmbeddingIndexSettings,
    terms: string[],
    batchSize: number,
    progressCallback?: (
        terms: string[],
        batch: collections.Slice<string>,
    ) => boolean,
): Promise<TermEmbeddingIndex> {
    const termIndex = new TermEmbeddingIndex(settings);
    for (const slice of collections.slices(terms, batchSize)) {
        if (progressCallback && !progressCallback(terms, slice)) {
            break;
        }
        await termIndex.add(slice.value);
    }
    return termIndex;
}

export interface ITermEmbeddingIndex extends ITermToRelatedTermsFuzzy {
    serialize(): ITextEmbeddingIndexData;
    deserialize(data: ITextEmbeddingIndexData): void;
}

export class TermEmbeddingIndex
    extends TextEmbeddingIndex
    implements ITermEmbeddingIndex
{
    constructor(
        public settings: TextEmbeddingIndexSettings,
        data?: ITextEmbeddingIndexData,
    ) {
        super(settings, data);
    }

    public async lookupTerm(
        text: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<Term[]> {
        let matches = await super.getNearest(text, maxMatches, minScore);
        return this.matchesToTerms(matches);
    }

    public async lookupTerms(
        texts: string[],
        maxMatches?: number,
        minScore?: number,
    ): Promise<Term[][]> {
        const matchesList = await super.getNearestMultiple(
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
