// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MatchAccumulator, TextRangeCollection } from "../src/collections.js";
import { MessageOrdinal, TextRange } from "../src/interfaces.js";
import {
    textRangeFromMessage,
    textRangesFromMessageOrdinals,
} from "../src/message.js";
import { getBatchesFromCollection, MessageCollection } from "../src/storage.js";
import {
    createTestMessages,
    createTestMessagesArray,
    TestMessage,
} from "./testMessage.js";
import { verifyTextRanges } from "./verify.js";

describe("messageCollection", () => {
    test("addMessage", () => {
        const messageCollection = new MessageCollection();
        messageCollection.append(new TestMessage("One"));
        expect(messageCollection).toHaveLength(1);
        const m = messageCollection.get(0);
        expect(m).toBeDefined();
    });
    test("addMessages", () => {
        const messageCollection = new MessageCollection();
        messageCollection.append(
            new TestMessage("One"),
            new TestMessage("Two"),
        );
        expect(messageCollection).toHaveLength(2);

        let ordinals = [0, 1];
        let messages = messageCollection.getMultiple(ordinals);
        expect(messages).toHaveLength(ordinals.length);
        messages.forEach((m) => expect(m).toBeDefined());

        ordinals = [1, 2];
        messages = messageCollection.getMultiple(ordinals);
        expect(messages).toHaveLength(ordinals.length);
        expect(messages[0]).toBeDefined();
        expect(messages[1]).toBeUndefined();
    });
    test("constructor", () => {
        const messageCount = 10;
        const testMessages = createTestMessagesArray(messageCount);
        const messageCollection = new MessageCollection(testMessages);
        expect(messageCollection.length).toEqual(messageCount);
    });
    test("enumeration", () => {
        const messageCount = 10;
        const messageCollection = createTestMessages(messageCount);
        expect(messageCollection.length).toEqual(messageCount);
        // Enumeration
        let messagesCopy = [...messageCollection];
        expect(messagesCopy).toHaveLength(messageCollection.length);
    });
    test("batching", () => {
        const messageCount = 10;
        const messageCollection = createTestMessages(messageCount);
        expect(messageCollection.length).toEqual(messageCount);

        const messagesCopy = messageCollection.getAll();
        expect(messagesCopy).toHaveLength(messageCount);
        let completed = 0;
        let batchSize = 4;
        for (const batch of getBatchesFromCollection(
            messageCollection,
            0,
            batchSize,
        )) {
            expect(batch.startAt).toEqual(completed);
            const slice = messagesCopy.slice(
                batch.startAt,
                batch.startAt + batchSize,
            );
            expect(batch.value).toHaveLength(slice.length);
            completed += batch.value.length;
        }
    });
});

describe("TextRangeCollection", () => {
    test("messageOrdinalOnly", () => {
        const numRanges = 64;
        const subRangeLength = 4;
        const ranges = makeMessagesTextRanges(0, numRanges);
        const subRanges: TextRange[][] = [];
        for (let i = 0; i < ranges.length; i += subRangeLength) {
            subRanges.push(ranges.slice(i, i + subRangeLength));
        }
        const allowedSubRanges: TextRange[][] = [];
        const disallowedSubRanges: TextRange[][] = [];
        // Allow all odd numbered sub ranges
        for (let i = 0; i < subRanges.length; ++i) {
            if (i % 2 === 0) {
                disallowedSubRanges.push(subRanges[i]);
            } else {
                allowedSubRanges.push(subRanges[i]);
            }
        }
        const textRangeCollection = new TextRangeCollection();
        allowedSubRanges.forEach((r) => textRangeCollection.addRanges(r));

        for (const ranges of allowedSubRanges) {
            for (const range of ranges) {
                expect(textRangeCollection.isInRange(range)).toBeTruthy();
            }
        }
        for (const ranges of disallowedSubRanges) {
            for (const range of ranges) {
                expect(textRangeCollection.isInRange(range)).toBeFalsy();
            }
        }
    });
    test("nonContiguous", () => {
        let messageRanges = makeMessagesTextRanges(0, 7);
        let textRangeCollection = new TextRangeCollection();

        testRange(textRangeCollection, messageRanges, [0, 1, 6], 3);

        textRangeCollection.clear();
        testRange(textRangeCollection, messageRanges, [2, 3, 4, 5], 4);
    });
    test("sort", () => {
        let messageRanges = textRangesFromMessageOrdinals([
            5, 3, 9, 7, 12, 1, 2, 2, 5,
        ]);
        let textRangeCollection = new TextRangeCollection(messageRanges, true);
        verifyTextRanges(textRangeCollection);
    });

    function testRange(
        textRangeCollection: TextRangeCollection,
        allRanges: TextRange[],
        inRangeOrdinals: MessageOrdinal[],
        expectedMatchCount: number,
    ): void {
        textRangeCollection.addRanges(
            textRangesFromMessageOrdinals(inRangeOrdinals),
        );
        let matchCount = getMatchCount(textRangeCollection, allRanges);
        expect(matchCount).toBe(expectedMatchCount);
    }
});

function getMatchCount(
    textRangeCollection: TextRangeCollection,
    textRanges: Iterable<TextRange>,
): number {
    let matchCount = 0;
    for (let range of textRanges) {
        if (textRangeCollection.isInRange(range)) {
            ++matchCount;
        }
    }
    return matchCount;
}

function makeMessagesTextRanges(
    ordinalStartAt: MessageOrdinal,
    count: number,
): TextRange[] {
    const ranges: TextRange[] = [];
    for (let i = 0; i < count; ++i) {
        ranges.push(textRangeFromMessage(ordinalStartAt + i));
    }
    return ranges;
}

// Tests for MatchAccumulator
describe("MatchAccumulator", () => {
    test("addExact creates entry with hitCount 1", () => {
        const acc = new MatchAccumulator<string>();
        acc.addExact("hello", 0.9);
        const match = acc.getMatch("hello");
        expect(match).toBeDefined();
        expect(match!.hitCount).toBe(1);
        expect(match!.score).toBe(0.9);
        expect(match!.relatedHitCount).toBe(0);
        expect(match!.relatedScore).toBe(0);
    });

    test("addRelated creates entry with relatedHitCount 1 and zero score", () => {
        const acc = new MatchAccumulator<string>();
        acc.addRelated("hello", 0.8);
        const match = acc.getMatch("hello");
        expect(match).toBeDefined();
        expect(match!.hitCount).toBe(1);
        expect(match!.score).toBe(0);
        expect(match!.relatedHitCount).toBe(1);
        expect(match!.relatedScore).toBe(0.8);
    });

    test("addExact twice accumulates hitCount and score", () => {
        const acc = new MatchAccumulator<string>();
        acc.addExact("hello", 0.5);
        acc.addExact("hello", 0.3);
        const match = acc.getMatch("hello");
        expect(match).toBeDefined();
        expect(match!.hitCount).toBe(2);
        expect(match!.score).toBeCloseTo(0.8);
        expect(match!.relatedHitCount).toBe(0);
    });

    test("addRelated twice accumulates relatedHitCount and relatedScore", () => {
        const acc = new MatchAccumulator<string>();
        acc.addRelated("hello", 0.5);
        acc.addRelated("hello", 0.3);
        const match = acc.getMatch("hello");
        expect(match).toBeDefined();
        expect(match!.hitCount).toBe(1);
        expect(match!.relatedHitCount).toBe(2);
        expect(match!.relatedScore).toBeCloseTo(0.8);
    });

    test("addExact then addRelated on same value accumulates both", () => {
        const acc = new MatchAccumulator<string>();
        acc.addExact("hello", 0.9);
        acc.addRelated("hello", 0.4);
        const match = acc.getMatch("hello");
        expect(match).toBeDefined();
        expect(match!.hitCount).toBe(1);
        expect(match!.score).toBe(0.9);
        expect(match!.relatedHitCount).toBe(1);
        expect(match!.relatedScore).toBe(0.4);
    });

    test("size reflects number of unique values", () => {
        const acc = new MatchAccumulator<string>();
        expect(acc.size).toBe(0);
        acc.addExact("a", 1.0);
        acc.addExact("b", 0.5);
        acc.addExact("a", 0.3); // duplicate - should not increase size
        expect(acc.size).toBe(2);
    });

    test("getWithHitCount returns all matches when minHitCount is 0", () => {
        const acc = new MatchAccumulator<string>();
        acc.addExact("a", 1.0);
        acc.addRelated("b", 0.5);
        const results = acc.getWithHitCount(0);
        // All matches have hitCount >= 1 >= 0, so all should be returned
        expect(results).toHaveLength(2);
    });

    test("getWithHitCount with minHitCount 1 returns all matches (all have hitCount >= 1)", () => {
        const acc = new MatchAccumulator<string>();
        acc.addExact("a", 1.0);
        acc.addExact("b", 0.5);
        acc.addRelated("c", 0.3);
        // minHitCount=1 is a no-op since all matches have hitCount >= 1 by design
        const results = acc.getWithHitCount(1);
        expect(results).toHaveLength(3);
    });

    test("getWithHitCount with minHitCount 2 filters out single-hit matches", () => {
        const acc = new MatchAccumulator<string>();
        acc.addExact("a", 1.0);
        acc.addExact("a", 0.5); // hitCount becomes 2
        acc.addExact("b", 0.8); // hitCount stays at 1
        const results = acc.getWithHitCount(2);
        expect(results).toHaveLength(1);
        expect(results[0].value).toBe("a");
    });

    test("getWithHitCount with minHitCount 3 returns only highly-hit matches", () => {
        const acc = new MatchAccumulator<string>();
        acc.addExact("a", 0.5);
        acc.addExact("a", 0.5);
        acc.addExact("a", 0.5); // hitCount = 3
        acc.addExact("b", 0.5);
        acc.addExact("b", 0.5); // hitCount = 2
        acc.addExact("c", 0.5); // hitCount = 1
        const results = acc.getWithHitCount(3);
        expect(results).toHaveLength(1);
        expect(results[0].value).toBe("a");
    });

    test("getSortedByScore returns matches in descending score order", () => {
        const acc = new MatchAccumulator<string>();
        acc.addExact("low", 0.2);
        acc.addExact("high", 0.9);
        acc.addExact("mid", 0.5);
        const sorted = acc.getSortedByScore();
        expect(sorted).toHaveLength(3);
        expect(sorted[0].value).toBe("high");
        expect(sorted[1].value).toBe("mid");
        expect(sorted[2].value).toBe("low");
    });

    test("getSortedByScore with minHitCount filters before sorting", () => {
        const acc = new MatchAccumulator<string>();
        acc.addExact("a", 0.9); // hitCount=1
        acc.addExact("b", 0.7);
        acc.addExact("b", 0.3); // hitCount=2
        acc.addExact("c", 0.5); // hitCount=1
        const sorted = acc.getSortedByScore(2);
        expect(sorted).toHaveLength(1);
        expect(sorted[0].value).toBe("b");
    });

    test("selectWithHitCount retains only matches meeting threshold", () => {
        const acc = new MatchAccumulator<string>();
        acc.addExact("a", 1.0);
        acc.addExact("a", 0.5); // hitCount=2
        acc.addExact("b", 0.8); // hitCount=1
        acc.addExact("c", 0.6); // hitCount=1
        const retained = acc.selectWithHitCount(2);
        expect(retained).toBe(1);
        expect(acc.size).toBe(1);
        expect(acc.has("a")).toBe(true);
        expect(acc.has("b")).toBe(false);
    });

    test("addUnion combines two accumulators", () => {
        const acc1 = new MatchAccumulator<string>();
        acc1.addExact("a", 1.0);
        acc1.addExact("b", 0.5);

        const acc2 = new MatchAccumulator<string>();
        acc2.addExact("b", 0.3); // overlaps with acc1
        acc2.addExact("c", 0.7); // new

        acc1.addUnion(acc2);
        expect(acc1.size).toBe(3);
        // "b" should have accumulated hitCount from both
        const matchB = acc1.getMatch("b");
        expect(matchB).toBeDefined();
        expect(matchB!.hitCount).toBe(2);
    });

    test("intersect returns only common values with combined scores", () => {
        const acc1 = new MatchAccumulator<string>();
        acc1.addExact("a", 1.0);
        acc1.addExact("b", 0.5);

        const acc2 = new MatchAccumulator<string>();
        acc2.addExact("b", 0.3);
        acc2.addExact("c", 0.7);

        const intersection = new MatchAccumulator<string>();
        acc1.intersect(acc2, intersection);
        expect(intersection.size).toBe(1);
        expect(intersection.has("b")).toBe(true);
        expect(intersection.has("a")).toBe(false);
        expect(intersection.has("c")).toBe(false);
    });

    test("getTopNScoring returns limited number of highest scoring matches", () => {
        const acc = new MatchAccumulator<string>();
        acc.addExact("a", 0.3);
        acc.addExact("b", 0.9);
        acc.addExact("c", 0.6);
        acc.addExact("d", 0.1);
        const top2 = acc.getTopNScoring(2);
        expect(top2).toHaveLength(2);
        const values = top2.map((m) => m.value);
        expect(values).toContain("b");
        expect(values).toContain("c");
    });

    test("getTopNScoring with minHitCount filters before selecting top N", () => {
        const acc = new MatchAccumulator<string>();
        acc.addExact("a", 0.9); // hitCount=1
        acc.addExact("b", 0.7);
        acc.addExact("b", 0.3); // hitCount=2
        acc.addExact("c", 0.5);
        acc.addExact("c", 0.5); // hitCount=2
        acc.addExact("d", 0.1); // hitCount=1
        // Only b and c have hitCount >= 2
        const top = acc.getTopNScoring(undefined, 2);
        expect(top).toHaveLength(2);
        const values = top.map((m) => m.value);
        expect(values).toContain("b");
        expect(values).toContain("c");
    });

    test("getMaxHitCount returns the highest hitCount across all matches", () => {
        const acc = new MatchAccumulator<string>();
        acc.addExact("a", 1.0); // hitCount=1
        acc.addExact("b", 0.5);
        acc.addExact("b", 0.5);
        acc.addExact("b", 0.5); // hitCount=3
        acc.addExact("c", 0.3);
        acc.addExact("c", 0.3); // hitCount=2
        expect(acc.getMaxHitCount()).toBe(3);
    });

    test("clearMatches removes all matches", () => {
        const acc = new MatchAccumulator<string>();
        acc.addExact("a", 1.0);
        acc.addExact("b", 0.5);
        expect(acc.size).toBe(2);
        acc.clearMatches();
        expect(acc.size).toBe(0);
    });
});
