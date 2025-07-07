// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections } from "typeagent";
import { IConversation, ListIndexingResult, Term } from "./interfaces.js";
import { IndexingEventHandlers } from "./interfaces.js";
import { Scored } from "./common.js";
import {
    ITextEmbeddingIndexData,
    ITermsToRelatedTermsDataItem,
    ITermToRelatedTermsData,
    ITermsToRelatedTermsIndexData,
} from "./secondaryIndexes.js";
import {
    ITermToRelatedTermsIndex,
    ITermToRelatedTermsFuzzy,
    ITermToRelatedTerms,
} from "./interfaces.js";
import { SearchTerm } from "./interfaces.js";
import { isSearchTermWildcard } from "./common.js";
import { TermSet } from "./collections.js";
import {
    serializeEmbedding,
    TextEditDistanceIndex,
    TextEmbeddingIndex,
    TextEmbeddingIndexSettings,
} from "./fuzzyIndex.js";
import { TextEmbeddingCache } from "knowledge-processor";
import { CompiledSearchTerm, CompiledTermGroup } from "./compileLib.js";

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

    public removeTerm(term: string): void {
        this.map.delete(term);
    }

    public clear(): void {
        this.map.clear();
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

export type RelatedTermIndexSettings = {
    embeddingIndexSettings?: TextEmbeddingIndexSettings | undefined;
};

export class RelatedTermsIndex implements ITermToRelatedTermsIndex {
    private aliasMap: TermToRelatedTermsMap;
    private embeddingIndex: TermEmbeddingIndex | undefined;

    constructor(public settings: RelatedTermIndexSettings) {
        this.aliasMap = new TermToRelatedTermsMap();
        if (settings.embeddingIndexSettings) {
            this.embeddingIndex = new TermEmbeddingIndex(
                settings.embeddingIndexSettings,
            );
        }
    }

    public get aliases(): TermToRelatedTermsMap {
        return this.aliasMap;
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
            if (
                data.textEmbeddingData &&
                this.settings.embeddingIndexSettings
            ) {
                this.embeddingIndex = new TermEmbeddingIndex(
                    this.settings.embeddingIndexSettings,
                );
                this.embeddingIndex.deserialize(data.textEmbeddingData);
            }
        }
    }
}

export async function buildRelatedTermsIndex(
    conversation: IConversation,
    settings: RelatedTermIndexSettings,
    eventHandler?: IndexingEventHandlers,
): Promise<ListIndexingResult> {
    if (conversation.semanticRefIndex && conversation.secondaryIndexes) {
        const allTerms = conversation.semanticRefIndex.getTerms();
        return addToRelatedTermsIndex(
            conversation,
            settings,
            allTerms,
            eventHandler,
        );
    }
    return {
        numberCompleted: 0,
    };
}

export async function addToRelatedTermsIndex(
    conversation: IConversation,
    settings: RelatedTermIndexSettings,
    terms: string[],
    eventHandler?: IndexingEventHandlers,
): Promise<ListIndexingResult> {
    if (conversation.semanticRefIndex && conversation.secondaryIndexes) {
        conversation.secondaryIndexes.termToRelatedTermsIndex ??=
            new RelatedTermsIndex(settings);
        const fuzzyIndex =
            conversation.secondaryIndexes.termToRelatedTermsIndex.fuzzyIndex;
        if (fuzzyIndex && terms.length > 0) {
            return await fuzzyIndex.addTerms(terms, eventHandler);
        }
        return {
            numberCompleted: terms.length,
        };
    }
    return {
        numberCompleted: 0,
    };
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
    compiledTerms: CompiledTermGroup[],
    ensureSingleOccurrence: boolean = true,
    shouldResolveFuzzy?: (term: SearchTerm) => boolean,
): Promise<void> {
    const allSearchTerms = compiledTerms.flatMap((ct) => ct.terms);
    const searchableTerms = new TermSet();
    const searchTermsNeedingRelated: SearchTerm[] = [];
    for (const searchTerm of allSearchTerms) {
        if (isSearchTermWildcard(searchTerm)) {
            continue;
        }
        searchableTerms.addOrUnion(searchTerm.term);
        const termText = searchTerm.term.text;
        // Resolve any specific term to related term mappings
        if (
            relatedTermsIndex.aliases &&
            searchTerm.relatedTerms === undefined
        ) {
            searchTerm.relatedTerms =
                relatedTermsIndex.aliases.lookupTerm(termText);
        }
        // If no mappings to aliases
        // Then add this to the list of things for which we do fuzzy retrieval
        if (searchTerm.relatedTerms == undefined) {
            if (!shouldResolveFuzzy || shouldResolveFuzzy(searchTerm)) {
                searchTermsNeedingRelated.push(searchTerm);
            }
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
    for (const ct of compiledTerms) {
        dedupeRelatedTerms(
            ct.terms,
            ensureSingleOccurrence
                ? ct.booleanOp !== "and"
                : ensureSingleOccurrence,
        );
    }
}

function dedupeRelatedTerms(
    searchTerms: CompiledSearchTerm[],
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
        searchTerms.forEach((st) => {
            allRelatedTerms!.addOrUnion(st.relatedTerms);
        });
    }

    for (const searchTerm of searchTerms) {
        const required =
            searchTerm.relatedTermsRequired !== undefined
                ? searchTerm.relatedTermsRequired
                : false;
        if (required) {
            continue;
        }

        if (
            searchTerm.relatedTerms !== undefined &&
            searchTerm.relatedTerms.length > 0
        ) {
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

export class TermEmbeddingIndex
    implements ITermEmbeddingIndex, TextEmbeddingCache
{
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

    public async addTerms(
        terms: string[],
        eventHandler?: IndexingEventHandlers,
    ): Promise<ListIndexingResult> {
        const result = await this.embeddingIndex.addTextBatch(
            terms,
            eventHandler,
        );
        if (result.numberCompleted > 0) {
            this.textArray.push(...terms);
        }
        return result;
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

    public removeTerm(term: string): void {
        const indexOf = this.textArray.indexOf(term);
        if (indexOf >= 0) {
            this.textArray.splice(indexOf, 1);
            this.embeddingIndex.removeAt(indexOf);
        }
    }

    public clear(): void {
        this.textArray = [];
        this.embeddingIndex.clear();
    }

    public serialize(): ITextEmbeddingIndexData {
        return {
            textItems: this.textArray,
            embeddings: this.embeddingIndex.serialize(),
        };
    }

    public deserialize(data: ITextEmbeddingIndexData): void {
        if (data.textItems.length !== data.embeddings.length) {
            throw new Error(
                `TextEmbeddingIndexData corrupt. textItems.length ${data.textItems.length} != ${data.embeddings.length}`,
            );
        }
        this.textArray = data.textItems;
        this.embeddingIndex.deserialize(data.embeddings);
    }

    public getEmbedding(text: string): number[] | undefined {
        const pos = this.textArray.indexOf(text);
        if (pos >= 0) {
            return serializeEmbedding(this.embeddingIndex.get(pos));
        }
        return undefined;
    }

    private matchesToTerms(matches: Scored[]): Term[] {
        return matches.map((m) => {
            return { text: this.textArray[m.item], weight: m.score };
        });
    }
}

export class TermEditDistanceIndex
    extends TextEditDistanceIndex
    implements ITermToRelatedTermsFuzzy
{
    constructor(textArray: string[] = []) {
        super(textArray);
    }

    public async addTerms(terms: string[]): Promise<ListIndexingResult> {
        this.textArray.push(...terms);
        return {
            numberCompleted: terms.length,
        };
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

    private matchesToTerms(matches: Scored<string>[]): Term[] {
        return matches.map((m) => {
            return { text: m.item, weight: m.score };
        });
    }
}

/**
 * Note: TEMPORARY. Experimental. May eventually replace ITermToRelatedTermsIndex
 * Work in progress; Simplifying related terms
 */
/*
export interface ITermToRelatedTermsIndex2 {
    addTerms(
        termTexts: string[],
        eventHandler?: IndexingEventHandlers,
    ): Promise<ListIndexingResult>;
    addSynonyms(termText: string, relatedTerms: Term[]): void;
    lookupSynonym(termText: string): Term[] | undefined;
    lookupTermsFuzzy(
        termTexts: string[],
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<Term[][]>;
}

export class TermToRelatedTermsIndex2 implements ITermToRelatedTermsIndex2 {
    private synonyms: TermToRelatedTermsMap;
    private termEmbeddings: TermEmbeddingIndex;

    constructor(settings: TextEmbeddingIndexSettings) {
        this.synonyms = new TermToRelatedTermsMap();
        this.termEmbeddings = new TermEmbeddingIndex(settings);
    }

    public addTerms(
        termTexts: string[],
        eventHandler?: IndexingEventHandlers,
    ): Promise<ListIndexingResult> {
        return this.termEmbeddings.addTerms(termTexts, eventHandler);
    }

    public addSynonyms(termText: string, relatedTerm: Term[]): void {
        this.synonyms.addRelatedTerm(termText, relatedTerm);
    }

    public lookupSynonym(termText: string): Term[] | undefined {
        return this.synonyms.lookupTerm(termText);
    }

    public lookupTermsFuzzy(
        termTexts: string[],
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<Term[][]> {
        return this.termEmbeddings.lookupTerms(
            termTexts,
            maxMatches,
            thresholdScore,
        );
    }
}
*/
