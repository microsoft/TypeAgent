// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections, createTopNList } from "typeagent";
import {
    IMessage,
    IReadonlyCollection,
    Knowledge,
    KnowledgeType,
    MessageOrdinal,
    ScoredMessageOrdinal,
    ScoredSemanticRefOrdinal,
    SemanticRef,
    SemanticRefOrdinal,
    Term,
    TextRange,
} from "./interfaces.js";
import { compareTextRange, isInTextRange } from "./common.js";
import { ScoredTextLocation } from "./textLocationIndex.js";
import { getCountOfMessagesInCharBudget } from "./message.js";

/**
 * A matched value. Includes statistics for the quality and frequency of the match
 */
export interface Match<T = any> {
    value: T;
    score: number; // Overall cumulative score.
    hitCount: number; // # of hits.
    relatedScore: number; // Cumulative from matching related terms or phrases
    relatedHitCount: number; // # of hits from related term matches or phrases
}

/**
 * Sort in place
 * @param matches
 */
export function sortMatchesByRelevance(matches: Match[]) {
    matches.sort((x, y) => y.score - x.score);
}

/**
 * Accumulates matched values and Match statistics for each matched value
 */
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
                    hitCount: 1,
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
                this.combineMatches(existingMatch, otherMatch);
            } else {
                this.setMatch(otherMatch);
            }
        }
    }

    public intersect(
        other: MatchAccumulator,
        intersection?: MatchAccumulator,
    ): MatchAccumulator {
        intersection ??= new MatchAccumulator();
        for (const thisMatch of this.getMatches()) {
            const otherMatch = other.getMatch(thisMatch.value);
            if (otherMatch) {
                this.combineMatches(thisMatch, otherMatch);
                intersection.setMatch(thisMatch);
            }
        }
        return intersection;
    }

    private combineMatches(match: Match, other: Match) {
        match.hitCount += other.hitCount;
        match.score += other.score;
        match.relatedHitCount += other.relatedHitCount;
        match.relatedScore += other.relatedScore;
    }

    public calculateTotalScore(scorer?: (match: Match) => void): void {
        scorer ??= addSmoothAvgRelatedScore;
        for (const match of this.getMatches()) {
            scorer(match);
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

    /**
     * Iterate over all matches
     * @param predicate
     */
    public *getMatches(
        predicate?: (match: Match<T>) => boolean,
    ): IterableIterator<Match<T>> {
        for (const match of this.matches.values()) {
            if (predicate === undefined || predicate(match)) {
                yield match;
            }
        }
    }

    /**
     * Iterate over all matched values
     */
    public *getMatchedValues(): IterableIterator<T> {
        for (const match of this.matches.values()) {
            yield match.value;
        }
    }

    public clearMatches(): void {
        this.matches.clear();
    }

    /**
     * Selects and retains only top N scoring items.
     * @param maxMatches
     * @param minHitCount
     * @returns
     */
    public selectTopNScoring(
        maxMatches?: number,
        minHitCount?: number,
    ): number {
        const topN = this.getTopNScoring(maxMatches, minHitCount);
        this.setMatches(topN, true);
        return topN.length;
    }

    /**
     * Selects and retains only items with hitCount >= minHitCount.
     * @param minHitCount
     * @returns
     */
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

function addSmoothAvgRelatedScore(match: Match): void {
    if (match.relatedHitCount > 0) {
        const smoothRelatedScore = smoothAverageScore(
            match.relatedScore,
            match.relatedHitCount,
        );

        match.score += smoothRelatedScore;
    }
}

function smoothTotalScore(match: Match): void {
    if (match.hitCount > 0) {
        match.score = smoothAverageScore(match.score, match.hitCount);
    }
}

// Return an average score that also smoothens the impact of multiple matches
// If we just add up scores, a larger number of moderately related but noisy matches can overwhelm
// a small # of very good matches merely by having a larger total score...
// We also want diminishing returns for too many matches, which can also be indicative of noise...as the
// they can indicate low entropy.. prevents runaway scores
function smoothAverageScore(totalScore: number, hitCount: number): number {
    if (hitCount > 0) {
        if (hitCount === 1) {
            return totalScore;
        }
        const avg = totalScore / hitCount;
        const smoothAvg = Math.log(hitCount + 1) * avg;
        return smoothAvg;
    }
    return 0;
}

export type KnowledgePredicate<T extends Knowledge> = (knowledge: T) => boolean;

export class SemanticRefAccumulator extends MatchAccumulator<SemanticRefOrdinal> {
    constructor(public searchTermMatches = new Set<string>()) {
        super();
    }

    public addTermMatches(
        searchTerm: Term,
        scoredRefs:
            | ScoredSemanticRefOrdinal[]
            | IterableIterator<ScoredSemanticRefOrdinal>
            | undefined,
        isExactMatch: boolean,
        weight?: number,
    ) {
        if (scoredRefs) {
            weight ??= searchTerm.weight ?? 1;
            for (const scoredRef of scoredRefs) {
                this.add(
                    scoredRef.semanticRefOrdinal,
                    scoredRef.score * weight,
                    isExactMatch,
                );
            }
            this.searchTermMatches.add(searchTerm.text);
        }
    }

    public addTermMatchesIfNew(
        searchTerm: Term,
        scoredRefs:
            | ScoredSemanticRefOrdinal[]
            | IterableIterator<ScoredSemanticRefOrdinal>
            | undefined,
        isExactMatch: boolean,
        weight?: number,
    ) {
        if (scoredRefs) {
            weight ??= searchTerm.weight ?? 1;
            for (const scoredRef of scoredRefs) {
                if (!this.has(scoredRef.semanticRefOrdinal)) {
                    this.add(
                        scoredRef.semanticRefOrdinal,
                        scoredRef.score * weight,
                        isExactMatch,
                    );
                }
            }
            this.searchTermMatches.add(searchTerm.text);
        }
    }

    public override getSortedByScore(
        minHitCount?: number,
    ): Match<SemanticRefOrdinal>[] {
        return super.getSortedByScore(minHitCount);
    }

    public override getTopNScoring(
        maxMatches?: number,
        minHitCount?: number,
    ): Match<SemanticRefOrdinal>[] {
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
    ): IterableIterator<Match<SemanticRefOrdinal>> {
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
        rangesInScope: TextRangesInScope,
    ) {
        const accumulator = new SemanticRefAccumulator(this.searchTermMatches);
        for (const match of this.getMatches()) {
            if (rangesInScope.isRangeInScope(semanticRefs[match.value].range)) {
                accumulator.setMatch(match);
            }
        }
        return accumulator;
    }

    public override intersect(
        other: SemanticRefAccumulator,
    ): SemanticRefAccumulator {
        const intersection = new SemanticRefAccumulator();
        super.intersect(other, intersection);
        return intersection;
    }

    public toScoredSemanticRefs(): ScoredSemanticRefOrdinal[] {
        return this.getSortedByScore(0).map((m) => {
            return {
                semanticRefOrdinal: m.value,
                score: m.score,
            };
        }, 0);
    }

    public override clearMatches() {
        super.clearMatches();
        this.searchTermMatches.clear();
    }
}

export class MessageAccumulator extends MatchAccumulator<MessageOrdinal> {
    constructor(matches?: Match<MessageOrdinal>[]) {
        super();
        if (matches && matches.length > 0) {
            this.setMatches(matches);
        }
    }

    public override add(value: number, score: number): void {
        let match = this.getMatch(value);
        if (match === undefined) {
            match = {
                value,
                score,
                hitCount: 1,
                relatedHitCount: 0,
                relatedScore: 0,
            };
            this.setMatch(match);
        } else if (score > match.score) {
            match.score = score;
            match.hitCount++;
        }
    }

    /**
     * Add the message ordinals of the given text location
     * @param scoredTextLocations
     */
    public addMessagesFromLocations(
        scoredTextLocations: ScoredTextLocation[],
    ): void {
        for (const sl of scoredTextLocations) {
            this.add(sl.textLocation.messageOrdinal, sl.score);
        }
    }

    public addMessagesForSemanticRef(
        semanticRef: SemanticRef,
        score: number,
    ): void {
        const messageOrdinalStart = semanticRef.range.start.messageOrdinal;
        if (semanticRef.range.end) {
            const messageOrdinalEnd = semanticRef.range.end.messageOrdinal;
            for (
                let messageOrdinal = messageOrdinalStart;
                messageOrdinal < messageOrdinalEnd;
                ++messageOrdinal
            ) {
                this.add(messageOrdinal, score);
            }
        } else {
            this.add(messageOrdinalStart, score);
        }
    }

    public smoothScores() {
        // Normalize the score relative to # of hits.
        for (const match of this.getMatches()) {
            smoothTotalScore(match);
        }
    }

    public toScoredMessageOrdinals(): ScoredMessageOrdinal[] {
        return this.getSortedByScore(0).map((m) => {
            return {
                messageOrdinal: m.value,
                score: m.score,
            };
        }, 0);
    }

    public selectMessagesInBudget(
        messages: IMessage[],
        maxCharsInBudget: number,
    ): void {
        let scoredMatches = this.getSortedByScore();
        const rankedOrdinals = scoredMatches.map((m) => m.value);
        const messageCountInBudget = getCountOfMessagesInCharBudget(
            messages,
            rankedOrdinals,
            maxCharsInBudget,
        );
        this.clearMatches();
        if (messageCountInBudget > 0) {
            scoredMatches = scoredMatches.slice(0, messageCountInBudget);
            this.setMatches(scoredMatches);
        }
    }
}

export class TextRangeCollection {
    // Maintains ranges sorted by message index
    private ranges: TextRange[];

    constructor(ranges?: TextRange[] | undefined) {
        this.ranges = ranges ?? [];
    }

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
        if (this.ranges.length === 0) {
            return false;
        }
        // Find the first text range with messageIndex == rangeToMatch.start.messageIndex
        let i = collections.binarySearchFirst(
            this.ranges,
            rangeToMatch,
            (x, y) => x.start.messageIndex - y.start.messageIndex,
        );
        if (i < 0) {
            return false;
        }
        if (i == this.ranges.length) {
            i--;
        }
        // Now loop over all text ranges that start at rangeToMatch.start.messageIndex
        for (; i < this.ranges.length; ++i) {
            const range = this.ranges[i];
            if (
                range.start.messageOrdinal > rangeToMatch.start.messageOrdinal
            ) {
                break;
            }
            if (isInTextRange(range, rangeToMatch)) {
                return true;
            }
        }
        return false;
    }
}

export class TextRangesInScope {
    constructor(
        public textRanges: TextRangeCollection[] | undefined = undefined,
    ) {}

    public addTextRanges(ranges: TextRangeCollection): void {
        this.textRanges ??= [];
        this.textRanges.push(ranges);
    }

    public isRangeInScope(innerRange: TextRange): boolean {
        if (this.textRanges !== undefined) {
            /**
                Since outerRanges come from a set of range selectors, they may overlap, or may not agree.
                Outer ranges allowed by say a date range selector... may not be allowed by a tag selector.
                We have a very simple impl: we don't intersect/union ranges yet.
                Instead, we ensure that the innerRange is not rejected by any outerRanges
             */
            for (const outerRanges of this.textRanges) {
                if (!outerRanges.isInRange(innerRange)) {
                    return false;
                }
            }
        }
        return true;
    }
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

    public has(propertyName: string, propertyValue: Term | string): boolean {
        const key = this.makeKey(propertyName, propertyValue);
        return this.terms.has(key);
    }

    public clear(): void {
        this.terms.clear();
    }

    private makeKey(
        propertyName: string,
        propertyValue: Term | string,
    ): string {
        return (
            propertyName +
            ":" +
            (typeof propertyValue === "string"
                ? propertyValue
                : propertyValue.text)
        );
    }
}

/**
 * Unions two un-sorted arrays
 * @param xArray
 * @param yArray
 */
export function unionArrays<T = any>(
    x: T[] | undefined,
    y: T[] | undefined,
): T[] | undefined {
    if (x) {
        if (y) {
            return [...union(x.values(), y.values())];
        }
        return x;
    }
    return y;
}

/**
 * Unions two un-sorted iterators/arrays using a set
 * @param xArray
 * @param yArray
 */
function* union<T>(
    xArray: Iterator<T> | Array<T>,
    yArray: Iterator<T> | Array<T>,
): IterableIterator<T> {
    const x: Iterator<T> = Array.isArray(xArray) ? xArray.values() : xArray;
    const y: Iterator<T> = Array.isArray(yArray) ? yArray.values() : yArray;
    let unionSet = new Set<T>();
    let xVal = x.next();
    while (!xVal.done) {
        unionSet.add(xVal.value);
        xVal = x.next();
    }
    let yVal = y.next();
    while (!yVal.done) {
        unionSet.add(yVal.value);
        yVal = y.next();
    }
    for (const value of unionSet.values()) {
        yield value;
    }
}

export interface ICollection<T, TOrdinal>
    extends IReadonlyCollection<T, TOrdinal> {
    push(...items: T[]): void;
}

export class Collection<T, TOrdinal extends number>
    implements ICollection<T, TOrdinal>
{
    protected items: T[];

    constructor(items?: T[] | undefined) {
        this.items = items ?? [];
    }

    public get length(): number {
        return this.items.length;
    }

    public get(ordinal: TOrdinal): T | undefined {
        return this.items[ordinal];
    }

    public getMultiple(ordinals: TOrdinal[]): (T | undefined)[] {
        const items = new Array<T | undefined>(ordinals.length);
        for (let i = 0; i < ordinals.length; ++i) {
            items[i] = this.get(ordinals[i]);
        }
        return items;
    }

    public getAll(): T[] {
        return this.items;
    }

    public push(...items: T[]): void {
        for (const item of items) {
            this.items.push(item);
        }
    }

    public *[Symbol.iterator](): Iterator<T, any, any> {
        return this.items[Symbol.iterator]();
    }
}

export class MessageCollection<
    TMessage extends IMessage = IMessage,
> extends Collection<TMessage, MessageOrdinal> {}

export class SemanticRefCollection extends Collection<
    SemanticRef,
    SemanticRefOrdinal
> {}
