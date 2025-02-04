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
    hitCount: number;
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
    private maxHitCount: number;

    constructor() {
        this.matches = new Map<T, Match<T>>();
        this.maxHitCount = 0;
    }

    public get size(): number {
        return this.matches.size;
    }

    public get maxHits(): number {
        return this.maxHitCount;
    }

    public has(value: T): boolean {
        return this.matches.has(value);
    }

    public getMatch(value: T): Match<T> | undefined {
        return this.matches.get(value);
    }

    public setMatch(match: Match<T>): void {
        this.matches.set(match.value, match);
        if (match.hitCount > this.maxHitCount) {
            this.maxHitCount = match.hitCount;
        }
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

    public add(value: T, score: number): void {
        let match = this.matches.get(value);
        if (match !== undefined) {
            match.hitCount += 1;
            match.score += score;
        } else {
            match = {
                value,
                score,
                hitCount: 1,
            };
            this.matches.set(value, match);
        }
        if (match.hitCount > this.maxHitCount) {
            this.maxHitCount = match.hitCount;
        }
    }

    public addUnion(other: MatchAccumulator<T>): void {
        for (const otherMatch of other.matches.values()) {
            const existingMatch = this.matches.get(otherMatch.value);
            if (existingMatch) {
                existingMatch.hitCount += otherMatch.hitCount;
                existingMatch.score += otherMatch.score;
                if (existingMatch.hitCount > this.maxHitCount) {
                    this.maxHitCount = existingMatch.hitCount;
                }
            } else {
                this.setMatch(otherMatch);
            }
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
        this.maxHitCount = 0;
    }

    public selectTopNScoring(
        maxMatches?: number,
        minHitCount?: number,
    ): number {
        const topN = this.getTopNScoring(maxMatches, minHitCount);
        if (topN.length > 0) {
            this.setMatches(topN, true);
        }
        return topN.length;
    }

    private matchesWithMinHitCount(
        minHitCount: number | undefined,
    ): IterableIterator<Match<T>> {
        return minHitCount !== undefined && minHitCount > 0
            ? this.getMatches((m) => m.hitCount >= minHitCount)
            : this.matches.values();
    }
}

export type KnowledgePredicate<T extends Knowledge> = (knowledge: T) => boolean;

export class SemanticRefAccumulator extends MatchAccumulator<SemanticRefIndex> {
    constructor(public searchTermMatches = new Set<string>()) {
        super();
    }

    public addSearchTermMatch(
        searchTerm: Term,
        semanticRefs:
            | ScoredSemanticRef[]
            | IterableIterator<ScoredSemanticRef>
            | undefined,
        scoreBoost?: number,
    ) {
        if (semanticRefs) {
            scoreBoost ??= searchTerm.score ?? 0;
            for (const match of semanticRefs) {
                this.add(match.semanticRefIndex, match.score + scoreBoost);
            }
            this.searchTermMatches.add(searchTerm.text);
        }
    }

    public addRelatedTermMatch(
        searchTerm: Term,
        relatedTerm: Term,
        semanticRefs:
            | ScoredSemanticRef[]
            | IterableIterator<ScoredSemanticRef>
            | undefined,
        scoreBoost?: number,
    ) {
        if (semanticRefs) {
            // Related term matches count as matches for the queryTerm...
            // BUT are scored with the score of the related term
            scoreBoost ??= relatedTerm.score ?? 0;
            for (const semanticRef of semanticRefs) {
                let score = semanticRef.score + scoreBoost;
                let match = this.getMatch(semanticRef.semanticRefIndex);
                if (match !== undefined) {
                    if (match.score < score) {
                        match.score = score;
                    }
                } else {
                    match = {
                        value: semanticRef.semanticRefIndex,
                        score,
                        hitCount: 1,
                    };
                    this.setMatch(match);
                }
            }
            this.searchTermMatches.add(searchTerm.text);
        }
    }

    public addUnion(other: SemanticRefAccumulator): void {
        super.addUnion(other);
        unionInPlace(this.searchTermMatches, other.searchTermMatches);
    }

    public override getSortedByScore(
        minHitCount?: number,
    ): Match<SemanticRefIndex>[] {
        return super.getSortedByScore(this.getMinHitCount(minHitCount));
    }

    public override getTopNScoring(
        maxMatches?: number,
        minHitCount?: number,
    ): Match<SemanticRefIndex>[] {
        return super.getTopNScoring(
            maxMatches,
            this.getMinHitCount(minHitCount),
        );
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

    public intersect(other: SemanticRefAccumulator): SemanticRefAccumulator {
        const intersection = new SemanticRefAccumulator();
        let to = this.size > other.size ? this : other;
        let from = this.size > other.size ? other : this;
        for (const matchFrom of from.getMatches()) {
            const matchTo = to.getMatch(matchFrom.value);
            if (matchTo !== undefined) {
                intersection.setMatch({
                    hitCount: matchFrom.hitCount + matchTo.hitCount,
                    score: matchFrom.score + matchTo.score,
                    value: matchFrom.value,
                });
            }
        }
        return intersection;
    }

    public toScoredSemanticRefs(): ScoredSemanticRef[] {
        return this.getSortedByScore(0).map((m) => {
            return {
                semanticRefIndex: m.value,
                score: m.score,
            };
        }, 0);
    }

    private getMinHitCount(minHitCount?: number): number {
        return minHitCount !== undefined ? minHitCount : this.maxHits;
        //: this.queryTermMatches.termMatches.size;
    }
}

export class MessageAccumulator extends MatchAccumulator<IMessage> {}

export class TextRangeCollection {
    // Maintains ranges sorted by message index
    private ranges: TextRange[] = [];

    constructor() {}

    public get size() {
        return this.ranges.length;
    }

    public addRange(textRange: TextRange) {
        // Future: merge ranges
        collections.insertIntoSorted(this.ranges, textRange, this.comparer);
    }

    public addRanges(textRanges: TextRange[]) {
        for (const range of textRanges) {
            this.addRange(range);
        }
    }

    public isInRange(rangeToMatch: TextRange): boolean {
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

    private comparer(x: TextRange, y: TextRange): number {
        return x.start.messageIndex - y.start.messageIndex;
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
