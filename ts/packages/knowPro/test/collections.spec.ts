// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextRangeCollection } from "../src/collections.js";
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
