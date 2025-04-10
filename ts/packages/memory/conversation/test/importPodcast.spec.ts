// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getAbsolutePath, readTestFile } from "test-lib";
import { importPodcast, parsePodcastTranscript } from "../src/importPodcast.js";
import {
    createOfflineConversationSettings,
    getTestTranscripts,
} from "./testCommon.js";

describe("importPodcast.offline", () => {
    const testTimeout = 5 * 60 * 1000;
    const testTranscripts = getTestTranscripts();

    test("parseTranscript", () => {
        for (const test of testTranscripts) {
            const transcriptText = readTestFile(test.filePath);
            const [messages, participants] =
                parsePodcastTranscript(transcriptText);
            if (test.messageCount) {
                expect(messages).toHaveLength(test.messageCount);
            }
            if (test.participantCount) {
                expect(participants.size).toEqual(test.participantCount);
            }
        }
    });

    test(
        "importPodcast",
        async () => {
            const settings = createOfflineConversationSettings();
            for (const test of testTranscripts) {
                const podcast = await importPodcast(
                    getAbsolutePath(test.filePath),
                    test.name,
                    test.date,
                    test.length,
                    settings,
                );
                expect(podcast.messages.length).toBeGreaterThan(0);
                if (test.messageCount) {
                    expect(podcast.messages).toHaveLength(test.messageCount);
                }
                expect(podcast.nameTag).toEqual(test.name);
                if (test.participantCount) {
                    const participants = podcast.getParticipants();
                    expect(participants.size).toEqual(test.participantCount);
                }
            }
        },
        testTimeout,
    );
});
