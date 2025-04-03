// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createEmbeddingCache, TextEmbeddingCache } from "knowledge-processor";
import { createConversationSettings } from "knowpro";
import { NullEmbeddingModel } from "test-lib";

export type TranscriptInfo = {
    filePath: string;
    name: string;
    date: Date;
    length: number;
    participantCount?: number | undefined;
    messageCount?: number | undefined;
};

export function getTestTranscripts(): TranscriptInfo[] {
    return [
        {
            filePath: "./test/data/transcript_random.txt",
            name: "Test",
            date: new Date("March 2024"),
            length: 15,
            messageCount: 7,
            participantCount: 5,
        },
        {
            filePath: "./test/data/dialog.txt",
            name: "Dialog",
            date: new Date("Jan 1901"),
            length: 5,
            messageCount: 9,
            participantCount: 3,
        },
        {
            filePath:
                "../../knowpro/test/data/Episode_53_AdrianTchaikovsky.txt",
            name: "Episode_53",
            date: new Date("May 2023"),
            length: 60,
            messageCount: 105,
            participantCount: 3,
        },
    ];
}

export function createOfflineConversationSettings(
    getCache?: () => TextEmbeddingCache | undefined,
) {
    const cachingModel = createEmbeddingCache(
        new NullEmbeddingModel(),
        32,
        getCache,
    );
    return createConversationSettings(cachingModel);
}
