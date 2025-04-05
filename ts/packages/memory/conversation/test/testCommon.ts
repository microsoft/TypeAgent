// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createConversationSettings } from "knowpro";
import {
    createTestEmbeddingModel,
    getAbsolutePath,
    NullEmbeddingModel,
} from "test-lib";
import { importPodcast } from "../src/importPodcast.js";
import { Podcast } from "../src/podcast.js";

export type TestTranscriptInfo = {
    filePath: string;
    name: string;
    date: Date;
    length: number;
    participantCount?: number | undefined;
    messageCount?: number | undefined;
};

export function getTestTranscriptSmall(): TestTranscriptInfo {
    return {
        filePath: "./test/data/transcript_small.txt",
        name: "Test",
        date: new Date("March 2024"),
        length: 15,
        messageCount: 7,
        participantCount: 5,
    };
}

export function getTestTranscriptDialog(): TestTranscriptInfo {
    return {
        filePath: "./test/data/dialog.txt",
        name: "Dialog",
        date: new Date("Jan 1901"),
        length: 5,
        messageCount: 9,
        participantCount: 3,
    };
}

export function getTestTranscriptPodcast(): TestTranscriptInfo {
    return {
        filePath: "./test/data/Episode_53_AdrianTchaikovsky.txt",
        name: "Episode_53",
        date: new Date("May 2023"),
        length: 60,
        messageCount: 106,
        participantCount: 3,
    };
}

export function getTestTranscripts(): TestTranscriptInfo[] {
    return [
        getTestTranscriptSmall(),
        getTestTranscriptDialog(),
        getTestTranscriptPodcast(),
    ];
}

export function createOfflineConversationSettings() {
    return createConversationSettings(new NullEmbeddingModel(), 0);
}

export function createOnlineConversationSettings() {
    const [model, size] = createTestEmbeddingModel();
    return createConversationSettings(model, size);
}

export async function loadTestPodcast(
    test: TestTranscriptInfo,
    online: boolean,
    maxMessages?: number,
): Promise<Podcast> {
    const podcast = await importPodcast(
        getAbsolutePath(test.filePath),
        test.name,
        test.date,
        test.length,
        online
            ? createOnlineConversationSettings()
            : createOfflineConversationSettings(),
    );
    if (maxMessages !== undefined && maxMessages > 0) {
        podcast.messages = podcast.messages.slice(0, maxMessages);
    }
    return podcast;
}
