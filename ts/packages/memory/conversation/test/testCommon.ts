// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createConversationSettings,
    createKnowledgeExtractor,
    MessageCollection,
} from "knowpro";
import {
    createTestChatModel,
    createTestEmbeddingModel,
    getAbsolutePath,
    getOutputDirPath,
    NullEmbeddingModel,
} from "test-lib";
import { importPodcast } from "../src/importPodcast.js";
import { Podcast, PodcastMessage } from "../src/podcast.js";
import { ensureDir, removeDir } from "typeagent";

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
    const chatModel = createTestChatModel("conversation-memory");
    const settings = createConversationSettings(model, size);
    settings.semanticRefIndexSettings.knowledgeExtractor =
        createKnowledgeExtractor(chatModel);
    return settings;
}

export async function loadTestPodcast(
    testTranscript: TestTranscriptInfo,
    online: boolean,
    maxMessages?: number,
): Promise<Podcast> {
    const podcast = await importPodcast(
        getAbsolutePath(testTranscript.filePath),
        testTranscript.name,
        testTranscript.date,
        testTranscript.length,
        online
            ? createOnlineConversationSettings()
            : createOfflineConversationSettings(),
    );
    if (maxMessages !== undefined && maxMessages > 0) {
        podcast.messages = new MessageCollection<PodcastMessage>(
            podcast.messages.getSlice(0, maxMessages),
        );
    }
    return podcast;
}

export async function ensureOutputDir(name: string, clean: boolean = true) {
    const dirPath = getOutputDirPath(name);
    if (clean) {
        await removeDir(dirPath);
    }
    await ensureDir(dirPath);
    return dirPath;
}
