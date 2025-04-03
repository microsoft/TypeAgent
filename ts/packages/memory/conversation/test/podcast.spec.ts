// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getAbsolutePath, /*hasTestKeys,*/ testIf } from "test-lib";
import {
    createOnlineConversationSettings,
    getTestTranscriptDialog,
} from "./testCommon.js";
import { importPodcast } from "../src/importPodcast.js";
import { TextLocation } from "knowpro";

describe("podcast", () => {
    const testTimeout = 10 * 60 * 1000;
    // TODO: issue with this test
    testIf(
        "buildIndex",
        () => false,
        async () => {
            const test = getTestTranscriptDialog();
            const podcast = await importPodcast(
                getAbsolutePath(test.filePath),
                test.name,
                test.date,
                test.length,
                createOnlineConversationSettings(),
            );
            const results = await podcast.buildIndex();
            expect(results.semanticRefs).toBeDefined();

            const maxMessageOrdinal = podcast.messages.length - 1;
            verifyCompleted(
                results.semanticRefs?.completedUpto,
                maxMessageOrdinal,
            );
            verifyCompleted(
                results.secondaryIndexResults?.message?.completedUpto,
                maxMessageOrdinal,
            );
        },
        testTimeout,
    );

    function verifyCompleted(
        upto: TextLocation | undefined,
        expected: number,
    ): void {
        expect(upto).toBeDefined();
        if (upto) {
            expect(upto.messageOrdinal).toEqual(expected);
        }
    }
});
