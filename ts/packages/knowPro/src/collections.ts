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
import { compareTextRange, isInTextRange } from "./query.js";

export interface Match<T = any> {
    value: T;
    score: number;
    hitCount: number;
    relatedScore: number;
    relatedHitCount: number;
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

    public getMaxHitCount(): number {
        let maxHitCount = 0;
        for (const match of this.matches.values()) {
            if (match.hitCount > maxHitCount) {
                maxHitCount = match.hitCount;
            }
        }
        return maxHitCount;
    }

    public add(value: T, score: number, isExactMatch: boolean) {
        const existingMatch = this.getMatch(value);
        if (existingMatch) {
            //this.updateExisting(existingMatch, score, isExactMatch);
            if (isExactMatch) {
                existingMatch.hitCount++;
                existingMatch.score += score;
            } else {
                existingMatch.relatedHitCount++;
                existingMatch.relatedScore += score;
            }
        } else {
            if (isExactMatch) {
                this.setMatch({
                    value,
                    hitCount: 1,
                    score,
                    relatedHitCount: 0,
                    relatedScore: 0,
                });
            } else {
                this.setMatch({
                    value,
                    hitCount: 0,
                    score: 0,
                    relatedHitCount: 1,
                    relatedScore: score,
                });
            }
        }
    }

    public addUnion(other: MatchAccumulator) {
        for (const otherMatch of other.getMatches()) {
            const existingMatch = this.getMatch(otherMatch.value);
            if (existingMatch) {
                existingMatch.hitCount += otherMatch.hitCount;
                existingMatch.score += otherMatch.score;
                existingMatch.relatedHitCount += otherMatch.relatedHitCount;
                existingMatch.relatedScore += otherMatch.relatedScore;
            } else {
                this.setMatch(otherMatch);
            }
        }
    }

    public calculateTotalScore(): void {
        for (const match of this.getMatches()) {
            if (match.relatedHitCount > 0) {
                // Smooth the impact of multiple related term matches
                // If we just add up scores, a larger number of moderately related
                // but noisy matches can overwhelm a small # of highly related matches... etc
                const avgScore = match.relatedScore / match.relatedHitCount;
                const normalizedScore = Math.log(1 + avgScore);
                match.score += normalizedScore;
            }
        }
    }

    public ensureHitCount(): void {
        for (const match of this.getMatches()) {
            if (match.hitCount <= 0) {
                match.hitCount = 1;
            }
        }
    }

    protected updateExisting(
        existingMatch: Match,
        newScore: number,
        isExactMatch: boolean,
    ): void {
        if (isExactMatch) {
            existingMatch.hitCount++;
            existingMatch.score += newScore;
        } else if (existingMatch.relatedScore < newScore) {
            existingMatch.relatedScore = newScore;
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

    public getWithHitCount(minHitCount: number): Match<T>[] {
        return [...this.matchesWithMinHitCount(minHitCount)];
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

    public selectWithHitCount(minHitCount: number): number {
        const matches = this.getWithHitCount(minHitCount);
        this.setMatches(matches, true);
        return matches.length;
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

    public addTermMatches(
        searchTerm: Term,
        scoredRefs:
            | ScoredSemanticRef[]
            | IterableIterator<ScoredSemanticRef>
            | undefined,
        isExactMatch: boolean,
        weight?: number,
    ) {
        if (scoredRefs) {
            weight ??= searchTerm.weight ?? 1;
            for (const scoredRef of scoredRefs) {
                this.add(
                    scoredRef.semanticRefIndex,
                    scoredRef.score * weight,
                    isExactMatch,
                );
            }
            this.searchTermMatches.add(searchTerm.text);
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
    ): IterableIterator<SemanticRef> {
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

    public getMatchesInScope(
        semanticRefs: SemanticRef[],
        textRangesInScope: TextRangeCollection[],
    ) {
        const accumulator = new SemanticRefAccumulator(this.searchTermMatches);
        for (const match of this.getMatches()) {
            if (
                isInAllTextRanges(
                    textRangesInScope,
                    semanticRefs[match.value].range,
                )
            ) {
                accumulator.setMatch(match);
            }
        }
        return accumulator;
    }

    public toScoredSemanticRefs(): ScoredSemanticRef[] {
        return this.getSortedByScore(0).map((m) => {
            return {
                semanticRefIndex: m.value,
                score: m.score,
            };
        }, 0);
    }

    public override clearMatches() {
        super.clearMatches();
        this.searchTermMatches.clear();
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

    public addRange(textRange: TextRange): boolean {
        // Future: merge ranges

        // Is this text range already in this collection?
        let pos = collections.binarySearch(
            this.ranges,
            textRange,
            compareTextRange,
        );
        if (pos >= 0) {
            // Already exists
            return false;
        }
        this.ranges.splice(~pos, 0, textRange);
        return true;
    }

    public addRanges(textRanges: TextRange[] | TextRangeCollection) {
        if (Array.isArray(textRanges)) {
            textRanges.forEach((t) => this.addRange(t));
        } else {
            textRanges.ranges.forEach((t) => this.addRange(t));
        }
    }

    public isInRange(rangeToMatch: TextRange): boolean {
        // Find the first text range with messageIndex == rangeToMatch.start.messageIndex
        let i = collections.binarySearchFirst(
            this.ranges,
            rangeToMatch,
            (x, y) => x.start.messageIndex - y.start.messageIndex,
        );
        if (i < 0) {
            return false;
        }
        // Now loop over all text ranges that start at rangeToMatch.start.messageIndex
        for (; i < this.ranges.length; ++i) {
            const range = this.ranges[i];
            if (range.start.messageIndex !== rangeToMatch.start.messageIndex) {
                break;
            }
            if (isInTextRange(range, rangeToMatch)) {
                return true;
            }
        }
        return false;
    }
}

/**
 * Return false if inner range is not in ALL the given ranges
 */
function isInAllTextRanges(
    ranges: TextRangeCollection[],
    innerRange: TextRange,
): boolean {
    for (const outerRange of ranges) {
        if (!outerRange.isInRange(innerRange)) {
            return false;
        }
    }
    return true;
}

export class TermSet {
    private terms: Map<string, Term> = new Map();
    constructor(terms?: Term[]) {
        if (terms) {
            this.addOrUnion(terms);
        }
    }

    public get size() {
        return this.terms.size;
    }

    public add(term: Term): boolean {
        const existingTerm = this.terms.get(term.text);
        if (existingTerm) {
            return false;
        }
        this.terms.set(term.text, term);
        return true;
    }

    public addOrUnion(terms: Term | Term[] | undefined) {
        if (terms === undefined) {
            return;
        }
        if (Array.isArray(terms)) {
            for (const term of terms) {
                this.addOrUnion(term);
            }
        } else {
            const term = terms;
            const existingTerm = this.terms.get(term.text);
            if (existingTerm) {
                const existingScore = existingTerm.weight ?? 0;
                const newScore = term.weight ?? 0;
                if (existingScore < newScore) {
                    existingTerm.weight = newScore;
                }
            } else {
                this.terms.set(term.text, term);
            }
        }
    }

    public get(term: string | Term): Term | undefined {
        return typeof term === "string"
            ? this.terms.get(term)
            : this.terms.get(term.text);
    }

    public getWeight(term: Term): number | undefined {
        return this.terms.get(term.text)?.weight;
    }

    public has(term: Term): boolean {
        return this.terms.has(term.text);
    }

    public remove(term: Term) {
        this.terms.delete(term.text);
    }
    public clear(): void {
        this.terms.clear();
    }

    public values() {
        return this.terms.values();
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
