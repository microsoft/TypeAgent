// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describeIf, hasTestKeys } from "test-lib";
import {
    getTestTranscriptDialog,
    loadTestPodcast,
    // getTestTranscriptSmall,
} from "./testCommon.js";
import {
    buildSemanticRefIndex,
    IndexingResults,
    TextIndexingResult,
    TextLocation,
} from "knowpro";

describeIf(
    "podcast.online",
    () => hasTestKeys(),
    () => {
        const testTimeout = 10 * 60 * 1000;
        test(
            "buildIndex",
            async () => {
                //const test = getTestTranscriptSmall();
                const maxMessages = 4;
                const podcast = await loadTestPodcast(
                    getTestTranscriptDialog(),
                    true,
                    maxMessages,
                );
                const results = await podcast.buildIndex();
                verifyNoIndexingErrors(results);

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
        test(
            "buildIndex.batch",
            async () => {
                const maxMessages = 8;
                const podcast = await loadTestPodcast(
                    getTestTranscriptDialog(),
                    true,
                    maxMessages,
                );
                podcast.settings.semanticRefIndexSettings.batchSize = 3;
                const results = await buildSemanticRefIndex(
                    podcast,
                    podcast.settings.semanticRefIndexSettings,
                );
                verifyNoTextIndexingError(results);

                const maxMessageOrdinal = podcast.messages.length - 1;
                verifyCompletedUpto(results.completedUpto, maxMessageOrdinal);
            },
            testTimeout,
        );

        function verifyNoIndexingErrors(results: IndexingResults) {
            verifyNoTextIndexingError(results.semanticRefs);
            verifyNoTextIndexingError(results.secondaryIndexResults?.message);
            verifyNoTextIndexingError(
                results.secondaryIndexResults?.properties,
            );
            verifyNoTextIndexingError(
                results.secondaryIndexResults?.relatedTerms,
            );
            verifyNoTextIndexingError(
                results.secondaryIndexResults?.timestamps,
            );
        }

        function verifyNoTextIndexingError(
            result: TextIndexingResult | undefined,
        ) {
            expect(result).toBeDefined();
            if (result?.error) {
                console.log(`Text indexing error ${result.error}`);
            }
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
    },
);
