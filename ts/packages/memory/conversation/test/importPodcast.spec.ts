// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parsePodcastSpeakers,
    parsePodcastTranscript,
} from "../src/importPodcast.js";
import { loadTestFile } from "./testCommon.js";

describe("conversation.importPodcast", () => {
    const testTranscripts: TranscriptInfo[] = [
        {
            filePath: "./test/data/transcript_random.txt",
            speechCount: 7,
            participantCount: 5,
        },
        {
            filePath: "../../knowpro/test/data/dialog.txt",
            speechCount: 9,
            participantCount: 3,
        },
    ];

    test("parseSpeakers", () => {
        for (const test of testTranscripts) {
            const transcriptText = loadTestFile(test.filePath);
            const speakers = parsePodcastSpeakers(transcriptText);
            if (test.speechCount) {
                expect(speakers).toHaveLength(test.speechCount);
            }
        }
    });

    test("parseTranscript", () => {
        for (const test of testTranscripts) {
            const transcriptText = loadTestFile(test.filePath);
            const [messages, participants] =
                parsePodcastTranscript(transcriptText);
            if (test.speechCount) {
                expect(messages).toHaveLength(test.speechCount);
            }
            if (test.participantCount) {
                expect(participants.size).toEqual(test.participantCount);
            }
        }
    });
});

type TranscriptInfo = {
    filePath: string;
    participantCount?: number | undefined;
    speechCount?: number | undefined;
};
