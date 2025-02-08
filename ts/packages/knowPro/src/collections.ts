// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections, createTopNList } from "typeagent";
import {
    IMessage,
    Knowledge,
    KnowledgeType,
    ScoredSemanticRef,
    SemanticRef,
    SemanticRefIndex,
    Term,
    TextRange,
} from "./dataFormat.js";
import { isInTextRange } from "./query.js";

export interface Match<T = any> {
    value: T;
    score: number;
    exactHitCount: number;
}

/**
 * Sort in place
 * @param matches
 */
export function sortMatchesByRelevance(matches: Match[]) {
    matches.sort((x, y) => y.score - x.score);
}

export class MatchAccumulator<T = any> {
    private matches: Map<T, Match<T>>;

    constructor() {
        this.matches = new Map<T, Match<T>>();
    }

    public get size(): number {
        return this.matches.size;
    }

    public has(value: T): boolean {
        return this.matches.has(value);
    }

    public getMatch(value: T): Match<T> | undefined {
        return this.matches.get(value);
    }

    public setMatch(match: Match<T>): void {
        this.matches.set(match.value, match);
    }

    public setMatches(
        matches: Match<T>[] | IterableIterator<Match<T>>,
        clear = false,
    ): void {
        if (clear) {
            this.clearMatches();
        }
        for (const match of matches) {
            this.setMatch(match);
        }
    }

    public add(value: T, score: number, isExactMatch: boolean) {
        const existingMatch = this.getMatch(value);
        if (existingMatch) {
            this.updateExisting(existingMatch, score, isExactMatch);
        } else {
            this.setMatch({
                value,
                exactHitCount: isExactMatch ? 1 : 0,
                score,
            });
        }
    }

    protected updateExisting(
        existingMatch: Match,
        newScore: number,
        isExactMatch: boolean,
    ): void {
        if (isExactMatch) {
            existingMatch.exactHitCount++;
            existingMatch.score += newScore;
        } else if (existingMatch.score < newScore) {
            existingMatch.score = newScore;
        }
    }

    public getSortedByScore(minHitCount?: number): Match<T>[] {
        if (this.matches.size === 0) {
            return [];
        }
        const matches = [...this.matchesWithMinHitCount(minHitCount)];
        matches.sort((x, y) => y.score - x.score);
        return matches;
    }

    /**
     * Return the top N scoring matches
     * @param maxMatches
     * @returns
     */
    public getTopNScoring(
        maxMatches?: number,
        minHitCount?: number,
    ): Match<T>[] {
        if (this.matches.size === 0) {
            return [];
        }
        if (maxMatches && maxMatches > 0) {
            const topList = createTopNList<T>(maxMatches);
            for (const match of this.matchesWithMinHitCount(minHitCount)) {
                topList.push(match.value, match.score);
            }
            const ranked = topList.byRank();
            return ranked.map((m) => this.matches.get(m.item)!);
        } else {
            return this.getSortedByScore(minHitCount);
        }
    }

    public *getMatches(
        predicate?: (match: Match<T>) => boolean,
    ): IterableIterator<Match<T>> {
        for (const match of this.matches.values()) {
            if (predicate === undefined || predicate(match)) {
                yield match;
            }
        }
    }

    public clearMatches(): void {
        this.matches.clear();
    }

    public selectTopNScoring(
        maxMatches?: number,
        minHitCount?: number,
    ): number {
        const topN = this.getTopNScoring(maxMatches, minHitCount);
        this.setMatches(topN, true);
        return topN.length;
    }

    private matchesWithMinHitCount(
        minHitCount: number | undefined,
    ): IterableIterator<Match<T>> {
        return minHitCount !== undefined && minHitCount > 0
            ? this.getMatches((m) => m.exactHitCount >= minHitCount)
            : this.matches.values();
    }
}

export type KnowledgePredicate<T extends Knowledge> = (knowledge: T) => boolean;

export class SemanticRefAccumulator extends MatchAccumulator<SemanticRefIndex> {
    constructor(public searchTermMatches = new Set<string>()) {
        super();
    }

    public addTermMatches(
        searchTerm: Term,
        scoredRefs:
            | ScoredSemanticRef[]
            | IterableIterator<ScoredSemanticRef>
            | undefined,
        isExactMatch: boolean,
        scoreBoost?: number,
    ) {
        if (scoredRefs) {
            scoreBoost ??= searchTerm.score ?? 0;
            for (const scoredRef of scoredRefs) {
                this.add(
                    scoredRef.semanticRefIndex,
                    scoredRef.score + scoreBoost,
                    isExactMatch,
                );
            }
            this.searchTermMatches.add(searchTerm.text);
        }
    }

    public updateTermMatches(
        searchTerm: Term,
        scoredRefs:
            | ScoredSemanticRef[]
            | IterableIterator<ScoredSemanticRef>
            | undefined,
        isExactMatch: boolean,
        scoreBoost?: number,
    ) {
        if (scoredRefs) {
            scoreBoost ??= searchTerm.score ?? 0;
            for (const scoredRef of scoredRefs) {
                const existingMatch = this.getMatch(scoredRef.semanticRefIndex);
                if (existingMatch) {
                    this.updateExisting(
                        existingMatch,
                        scoredRef.score + scoreBoost,
                        isExactMatch,
                    );
                } else {
                    throw new Error(
                        `No existing match for ${searchTerm.text} Id: ${scoredRef.semanticRefIndex}`,
                    );
                }
            }
        }
    }

    public override getSortedByScore(
        minHitCount?: number,
    ): Match<SemanticRefIndex>[] {
        return super.getSortedByScore(minHitCount);
    }

    public override getTopNScoring(
        maxMatches?: number,
        minHitCount?: number,
    ): Match<SemanticRefIndex>[] {
        return super.getTopNScoring(maxMatches, minHitCount);
    }

    public *getSemanticRefs(
        semanticRefs: SemanticRef[],
        predicate?: (semanticRef: SemanticRef) => boolean,
    ) {
        for (const match of this.getMatches()) {
            const semanticRef = semanticRefs[match.value];
            if (predicate === undefined || predicate(semanticRef))
                yield semanticRef;
        }
    }

    public *getMatchesOfType<T extends Knowledge>(
        semanticRefs: SemanticRef[],
        knowledgeType: KnowledgeType,
        predicate?: KnowledgePredicate<T>,
    ): IterableIterator<Match<SemanticRefIndex>> {
        for (const match of this.getMatches()) {
            const semanticRef = semanticRefs[match.value];
            if (semanticRef.knowledgeType === knowledgeType) {
                if (
                    predicate === undefined ||
                    predicate(semanticRef.knowledge as T)
                )
                    yield match;
            }
        }
    }

    public groupMatchesByType(
        semanticRefs: SemanticRef[],
    ): Map<KnowledgeType, SemanticRefAccumulator> {
        const groups = new Map<KnowledgeType, SemanticRefAccumulator>();
        for (const match of this.getMatches()) {
            const semanticRef = semanticRefs[match.value];
            let group = groups.get(semanticRef.knowledgeType);
            if (group === undefined) {
                group = new SemanticRefAccumulator();
                group.searchTermMatches = this.searchTermMatches;
                groups.set(semanticRef.knowledgeType, group);
            }
            group.setMatch(match);
        }
        return groups;
    }

    public getInScope(semanticRefs: SemanticRef[], scope: TextRangeCollection) {
        const accumulator = new SemanticRefAccumulator(this.searchTermMatches);
        for (const match of this.getMatches()) {
            if (scope.isInRange(semanticRefs[match.value].range)) {
                accumulator.setMatch(match);
            }
        }
        return accumulator;
    }

    public selectKnowledge<T extends Knowledge>(
        semanticRefs: SemanticRef[],
        knowledgeType: KnowledgeType,
        predicate?: KnowledgePredicate<T> | undefined,
    ): void {
        if (predicate) {
            const selectedMatches = [
                ...this.getMatchesOfType<T>(
                    semanticRefs,
                    knowledgeType,
                    predicate,
                ),
            ];
            if (selectedMatches.length > 0) {
                this.setMatches(selectedMatches);
                return;
            }
        }
        this.clearMatches();
    }

    public toScoredSemanticRefs(): ScoredSemanticRef[] {
        return this.getSortedByScore(0).map((m) => {
            return {
                semanticRefIndex: m.value,
                score: m.score,
            };
        }, 0);
    }
}

export class MessageAccumulator extends MatchAccumulator<IMessage> {}

export class TextRangeCollection {
    // Maintains ranges sorted by message index
    private ranges: TextRange[] = [];
    private sorted: boolean = false;

    constructor() {}

    public get size() {
        return this.ranges.length;
    }

    public addRange(textRange: TextRange) {
        // Future: merge ranges
        //collections.insertIntoSorted(this.ranges, textRange, this.comparer);
        this.ranges.push(textRange);
        this.sorted = false;
    }

    public addRanges(textRanges: TextRange[]) {
        for (const range of textRanges) {
            this.addRange(range);
        }
    }

    public isInRange(rangeToMatch: TextRange): boolean {
        this.ensureSorted();

        let i = collections.binarySearchFirst(
            this.ranges,
            rangeToMatch,
            this.comparer,
        );
        if (i < 0) {
            return false;
        }
        for (; i < this.ranges.length; ++i) {
            const range = this.ranges[i];
            if (range.start.messageIndex > rangeToMatch.start.messageIndex) {
                // We are at a range whose start is > rangeToMatch. Stop
                break;
            }
            if (isInTextRange(range, rangeToMatch)) {
                return true;
            }
        }
        return false;
    }

    private ensureSorted() {
        if (!this.sorted) {
            this.ranges.sort(this.comparer);
            this.sorted = true;
        }
    }

    private comparer(x: TextRange, y: TextRange): number {
        return x.start.messageIndex - y.start.messageIndex;
    }
}

export class TermSet {
    constructor(private terms: Map<string, Term> = new Map()) {}

    public add(term: Term) {
        const existingTerm = this.terms.get(term.text);
        if (!existingTerm) {
            this.terms.set(term.text, term);
        }
    }

    public addOrUnion(term: Term) {
        const existingTerm = this.terms.get(term.text);
        if (existingTerm) {
            const existingScore = existingTerm.score ?? 0;
            const newScore = term.score ?? 0;
            if (existingScore < newScore) {
                existingTerm.score = newScore;
            }
        } else {
            this.terms.set(term.text, term);
        }
    }

    public get(term: string | Term): Term | undefined {
        return typeof term === "string"
            ? this.terms.get(term)
            : this.terms.get(term.text);
    }

    public has(term: Term): boolean {
        return this.terms.has(term.text);
    }

    public clear(): void {
        this.terms.clear();
    }
}

export class PropertyTermSet {
    constructor(private terms: Map<string, Term> = new Map()) {}

    public add(propertyName: string, propertyValue: Term) {
        const key = this.makeKey(propertyName, propertyValue);
        const existingTerm = this.terms.get(key);
        if (!existingTerm) {
            this.terms.set(key, propertyValue);
        }
    }

    public has(propertyName: string, propertyValue: Term): boolean {
        const key = this.makeKey(propertyName, propertyValue);
        return this.terms.has(key);
    }

    public clear(): void {
        this.terms.clear();
    }

    private makeKey(propertyName: string, propertyValue: Term): string {
        return propertyName + ":" + propertyValue.text;
    }
}

/**
 * Return a new set that is the union of two sets
 * @param x
 * @param y
 * @returns
 */
export function unionSet<T = any>(x: Set<T>, y: Set<T>): Set<T> {
    let from: Set<T>;
    let to: Set<T>;
    if (x.size > y.size) {
        from = y;
        to = x;
    } else {
        from = x;
        to = y;
    }
    const union = new Set(to);
    if (from.size > 0) {
        for (const value of from.values()) {
            union.add(value);
        }
    }
    return union;
}

export function unionInPlace<T = any>(set: Set<T>, other: Set<T>): void {
    if (other.size > 0) {
        for (const value of other.values()) {
            set.add(value);
        }
    }
}
