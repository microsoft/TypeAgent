// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getAbsolutePath,
    hasTestKeys,
    /*hasTestKeys,*/ testIf,
} from "test-lib";
import {
    createOnlineConversationSettings,
    getTestTranscriptSmall,
} from "./testCommon.js";
import { importPodcast } from "../src/importPodcast.js";
import { IndexingResults, TextIndexingResult, TextLocation } from "knowpro";

describe("podcast", () => {
    const testTimeout = 10 * 60 * 1000;
    testIf(
        "buildIndex",
        () => hasTestKeys(),
        async () => {
            const test = getTestTranscriptSmall();
            const maxMessages = 4;
            // TODO: issue with this file..
            //const test = getTestTranscriptDialog();
            const podcast = await importPodcast(
                getAbsolutePath(test.filePath),
                test.name,
                test.date,
                test.length,
                createOnlineConversationSettings(),
            );
            podcast.messages = podcast.messages.slice(0, maxMessages);
            const results = await podcast.buildIndex();
            verifyNoErrors(results);

            const maxMessageOrdinal = podcast.messages.length - 1;
            verifyCompletedUpto(
                results.semanticRefs?.completedUpto,
                maxMessageOrdinal,
            );
            verifyNumberCompleted(
                results.secondaryIndexResults?.message?.numberCompleted,
                podcast.messages.length,
            );
        },
        testTimeout,
    );

    function verifyNoErrors(results: IndexingResults) {
        verifyNoError(results.semanticRefs);
        verifyNoError(results.secondaryIndexResults?.message);
        verifyNoError(results.secondaryIndexResults?.properties);
        verifyNoError(results.secondaryIndexResults?.relatedTerms);
        verifyNoError(results.secondaryIndexResults?.timestamps);
    }

    function verifyNoError(result: TextIndexingResult | undefined) {
        expect(result).toBeDefined();
        expect(result?.error).toBeUndefined();
    }

    function verifyCompletedUpto(
        upto: TextLocation | undefined,
        expectedUpto: number,
    ): void {
        expect(upto).toBeDefined();
        if (upto) {
            expect(upto.messageOrdinal).toEqual(expectedUpto);
        }
    }

    function verifyNumberCompleted(
        numberCompleted: number | undefined,
        expected: number,
    ): void {
        expect(numberCompleted).toBeDefined();
        if (numberCompleted) {
            expect(numberCompleted).toEqual(expected);
        }
    }
});
