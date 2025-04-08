// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describeIf, hasTestKeys } from "test-lib";
import {
    getTestTranscriptDialog,
    loadTestPodcast,
    // getTestTranscriptSmall,
} from "./testCommon.js";
import { buildSemanticRefIndex } from "knowpro";
import {
    verifyCompletedUpto,
    verifyNoIndexingErrors,
    verifyNoTextIndexingError,
    verifyNumberCompleted,
    verifyTermsInSemanticIndex,
} from "./verify.js";
import { Podcast } from "../src/podcast.js";

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
                verifyParticipants(podcast);
                verifyTermsInSemanticIndex(["piano"], podcast.semanticRefIndex);
            },
            testTimeout,
        );
        test(
            "buildIndex.semanticRef",
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

        function verifyParticipants(podcast: Podcast): void {
            const participants = podcast.getParticipants();
            verifyTermsInSemanticIndex(
                participants.values(),
                podcast.semanticRefIndex,
            );
        }
    },
);
