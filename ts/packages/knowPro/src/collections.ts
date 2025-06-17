// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * INTERNAL LIBRARY
 * COLLECTIONS USED BY QUERY PROCESSOR
 */

import { collections, createTopNList } from "typeagent";
import {
    IMessageCollection,
    ISemanticRefCollection,
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
import { Batch, compareTextRange, isInTextRange } from "./common.js";
import { ScoredTextLocation } from "./textLocationIndex.js";
import { getCountOfMessagesInCharBudget } from "./message.js";

/**
 * A matched value. Includes statistics for the quality and frequency of the match
 */
export interface Match<T = any> {
    value: T;
    score: number; // Overall cumulative score.
    hitCount: number; // # of hits. Always set to at least 1
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

    // TODO: make this 2 methods: addExact and addRelated
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

    public addUnion(other: MatchAccumulator | IterableIterator<Match>) {
        const otherMatches =
            other instanceof MatchAccumulator ? other.getMatches() : other;
        for (const otherMatch of otherMatches) {
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
        intersection: MatchAccumulator,
    ): MatchAccumulator {
        for (const thisMatch of this.getMatches()) {
            const otherMatch = other.getMatch(thisMatch.value);
            if (otherMatch) {
                this.combineMatches(thisMatch, otherMatch);
                intersection.setMatch(thisMatch);
            }
        }
        return intersection;
    }

    public intersectIter(
        other: IterableIterator<Match<T>> | Array<Match<T>>,
        intersection: MatchAccumulator,
    ): MatchAccumulator {
        for (const otherMatch of other) {
            const thisMatch = this.getMatch(otherMatch.value);
            if (thisMatch) {
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
        scorer ??= addSmoothRelatedScoreToMatchScore;
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

/**
    Return an score that smoothens a totalScore to compensate for multiple potentially noisy hits
    
    1. A totalScore is just all the individual scores from each hit added up. 
    Unfortunately, a larger number of moderately related but noisy matches can overwhelm
    a small # of very good matches merely by having a larger totalScore.
    
    2. We also want diminishing returns for too many hits. Too many hits can be indicative of noise...as the
    they can indicate low entropy of the thing being matched: its too common-place. 
    We want to prevent runaway scores that result from too many matches

    We currently adopt a simple but effective approach to smooth scores. 
    We address (1) by taking an average: this gives a cheap way of measuring the utility of each hit
    We address (2) by using a log function to get a hitCount that diminishes the impact of large # of hits.
    Then we return the average multiplied by the smooth hitCount, giving us a smoother score
    
    This is by no means perfect, but is a good default. 
    MatchAccumulator.calculateTotalScore allows you to pass in a smoothing function.
    As the need arises, we can make that available to code at higher layers. 
 */
function getSmoothScore(totalScore: number, hitCount: number): number {
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

/**
 * See {@link getSmoothScore}
 * @param match
 */
function addSmoothRelatedScoreToMatchScore(match: Match): void {
    if (match.relatedHitCount > 0) {
        // Related term matches can be noisy and duplicative. Comments on getSmoothScore explain why
        // we choose to smooth the impact of related term matches
        const smoothRelatedScore = getSmoothScore(
            match.relatedScore,
            match.relatedHitCount,
        );

        match.score += smoothRelatedScore;
    }
}

function smoothMatchScore(match: Match): void {
    if (match.hitCount > 0) {
        match.score = getSmoothScore(match.score, match.hitCount);
    }
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
        semanticRefs: ISemanticRefCollection,
        predicate?: (semanticRef: SemanticRef) => boolean,
    ): IterableIterator<SemanticRef> {
        for (const match of this.getMatches()) {
            const semanticRef = semanticRefs.get(match.value);
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
        semanticRefs: ISemanticRefCollection,
    ): Map<KnowledgeType, SemanticRefAccumulator> {
        const groups = new Map<KnowledgeType, SemanticRefAccumulator>();
        for (const match of this.getMatches()) {
            const semanticRef = semanticRefs.get(match.value);
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
        semanticRefs: ISemanticRefCollection,
        rangesInScope: TextRangesInScope,
    ) {
        const accumulator = new SemanticRefAccumulator(this.searchTermMatches);
        for (const match of this.getMatches()) {
            if (
                rangesInScope.isRangeInScope(
                    semanticRefs.get(match.value).range,
                )
            ) {
                accumulator.setMatch(match);
            }
        }
        return accumulator;
    }

    public override addUnion(other: SemanticRefAccumulator): void {
        super.addUnion(other);
        addToSet(this.searchTermMatches, other.searchTermMatches.values());
    }

    public override intersect(
        other: SemanticRefAccumulator,
    ): SemanticRefAccumulator {
        const intersection = new SemanticRefAccumulator();
        super.intersect(other, intersection);
        if (intersection.size > 0) {
            addToSet(
                intersection.searchTermMatches,
                this.searchTermMatches.values(),
            );
            addToSet(
                intersection.searchTermMatches,
                other.searchTermMatches.values(),
            );
        }
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

    public addRange(range: TextRange, score: number): void {
        this.add(range.start.messageOrdinal, score);
        if (range.end) {
            let ordinal = range.start.messageOrdinal + 1;
            let endOrdinal = range.end.messageOrdinal;
            for (; ordinal < endOrdinal; ++ordinal) {
                this.add(ordinal, score);
            }
        }
    }

    public addScoredMatches(matches: ScoredMessageOrdinal[]): void {
        for (const match of matches) {
            this.add(match.messageOrdinal, match.score);
        }
    }

    public override intersect(other: MessageAccumulator): MessageAccumulator {
        const intersection = new MessageAccumulator();
        super.intersect(other, intersection);
        return intersection;
    }

    public smoothScores() {
        // Normalize the score relative to # of hits.
        for (const match of this.getMatches()) {
            smoothMatchScore(match);
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
        messages: IMessageCollection,
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

    public static fromScoredOrdinals(
        ordinals: ScoredMessageOrdinal[] | undefined,
    ): MessageAccumulator {
        let accumulator = new MessageAccumulator();
        if (ordinals && ordinals.length > 0) {
            accumulator.addScoredMatches(ordinals);
        }
        return accumulator;
    }
}

export function intersectScoredMessageOrdinals(
    x: ScoredMessageOrdinal[] | undefined,
    y: ScoredMessageOrdinal[] | undefined,
) {
    let xSet =
        x !== undefined && x.length > 0
            ? MessageAccumulator.fromScoredOrdinals(x)
            : undefined;
    let ySet =
        y !== undefined && y?.length > 0
            ? MessageAccumulator.fromScoredOrdinals(y)
            : undefined;
    let intersection: MessageAccumulator | undefined;
    if (xSet === undefined || xSet.size === 0) {
        intersection = ySet;
    } else if (ySet === undefined || ySet.size === 0) {
        intersection = xSet;
    } else {
        intersection = xSet!.intersect(ySet!);
    }
    return intersection === undefined || intersection.size === 0
        ? []
        : intersection.toScoredMessageOrdinals();
}

export class TextRangeCollection implements Iterable<TextRange> {
    // Maintains ranges sorted by message index
    private ranges: TextRange[];

    constructor(
        ranges?: TextRange[] | undefined,
        ensureSorted: boolean = false,
    ) {
        if (ensureSorted) {
            this.ranges = [];
            if (ranges && ranges.length > 0) {
                this.addRanges(ranges);
            }
        } else {
            this.ranges = ranges ?? [];
        }
    }

    public get size() {
        return this.ranges.length;
    }

    public getRanges(): TextRange[] {
        return this.ranges;
    }

    public [Symbol.iterator](): Iterator<TextRange, any, any> {
        return this.ranges[Symbol.iterator]();
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
            (x, y) => x.start.messageOrdinal - y.start.messageOrdinal,
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

    public clear(): void {
        this.ranges = [];
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

export function addToSet<T = any>(set: Set<T>, values: Iterable<T>) {
    for (const value of values) {
        set.add(value);
    }
}

export function setUnion<T = any>(
    set: Set<T> | undefined,
    values: Iterable<T>,
): Set<T> {
    if (set === undefined) {
        set = new Set<T>(values);
    } else {
        addToSet(set, values);
    }
    return set;
}

export function setIntersect<T = any>(
    set: Set<T> | undefined,
    values: Iterable<T>,
): Set<T> {
    if (set === undefined) {
        set = new Set<T>(values);
    } else {
        let intersect = new Set<T>();
        for (const value of values) {
            if (set.has(value)) {
                intersect.add(value);
            }
        }
        set = intersect;
    }
    return set;
}

export function* getBatches<T = any>(
    array: T[],
    size: number,
): IterableIterator<Batch<T>> {
    for (let i = 0; i < array.length; i += size) {
        const slice = array.slice(i, i + size);
        if (slice.length === 0) {
            break;
        }
        yield { startAt: i, value: slice };
    }
}
