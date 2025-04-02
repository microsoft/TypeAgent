// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parsePodcastSpeakers,
    parsePodcastTranscript,
} from "../src/importPodcast.js";
import { loadTestFile } from "./testCommon.js";

describe("conversation.importPodcast", () => {
    const transcriptFilePath = "./test/data/transcript_random.txt";
    const transcriptText = loadTestFile(transcriptFilePath);
    const speechCount = 7;
    const participantCount = 5;

    test("parseSpeakers", () => {
        const speakers = parsePodcastSpeakers(transcriptText);
        expect(speakers).toHaveLength(speechCount);
    });

    test("parseTranscript", () => {
        const [messages, participants] = parsePodcastTranscript(transcriptText);
        expect(messages).toHaveLength(speechCount);
        expect(participants.size).toEqual(participantCount);
    });
});
