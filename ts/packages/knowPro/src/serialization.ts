// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile, readJsonFile, writeFile, writeJsonFile } from "typeagent";
import { deserializeEmbeddings, serializeEmbeddings } from "./fuzzyIndex.js";
import path from "path";
import { IConversationDataWithIndexes } from "./secondaryIndexes.js";

export async function writeConversationDataToFile(
    conversationData: IConversationDataWithIndexes,
    dirPath: string,
    baseFileName: string,
): Promise<void> {
    const serializationData = conversationDataToPersistent(conversationData);
    if (
        serializationData.embeddings &&
        serializationData.embeddings.length > 0
    ) {
        const embeddingsBuffer = serializeEmbeddings(
            serializationData.embeddings,
        );
        await writeFile(
            path.join(dirPath, baseFileName + EmbeddingFileSuffix),
            embeddingsBuffer,
        );
    }
    await writeJsonFile(
        path.join(dirPath, baseFileName + DataFileSuffix),
        serializationData.conversationData,
    );
}

export async function readConversationDataFromFile(
    dirPath: string,
    baseFileName: string,
    embeddingSize: number | undefined,
): Promise<IConversationDataWithIndexes | undefined> {
    const conversationData = await readJsonFile<IConversationDataWithIndexes>(
        path.join(dirPath, baseFileName + DataFileSuffix),
    );
    if (!conversationData) {
        return undefined;
    }
    let embeddings: Float32Array[] | undefined;
    if (embeddingSize && embeddingSize > 0) {
        const embeddingsBuffer = await readFile(
            path.join(dirPath, baseFileName + EmbeddingFileSuffix),
        );
        if (embeddingsBuffer) {
            embeddings = deserializeEmbeddings(embeddingsBuffer, embeddingSize);
        }
    }
    let serializationData: PersistedConversationData = {
        conversationData,
        embeddings,
    };
    return persistentToConversationData(serializationData);
}

const DataFileSuffix = "_data.json";
const EmbeddingFileSuffix = "_embeddings.bin";

type EmbeddingFileHeader = {
    relatedCount?: number | undefined;
    messageCount?: number | undefined;
};

interface ConversationFileData extends IConversationDataWithIndexes {
    embeddingFileHeader?: EmbeddingFileHeader | undefined;
}

type PersistedConversationData = {
    conversationData: ConversationFileData;
    embeddings?: Float32Array[] | undefined;
};

function conversationDataToPersistent(
    conversationData: IConversationDataWithIndexes,
): PersistedConversationData {
    let persistentData: PersistedConversationData = {
        conversationData: {
            ...conversationData,
            embeddingFileHeader: {},
        },
    };
    const embeddingFileHeader =
        persistentData.conversationData.embeddingFileHeader!;
    const relatedEmbeddings =
        conversationData.relatedTermsIndexData?.textEmbeddingData;
    if (relatedEmbeddings && relatedEmbeddings.embeddings.length > 0) {
        persistentData.embeddings ??= [];
        persistentData.embeddings.push(...relatedEmbeddings.embeddings);
        embeddingFileHeader.relatedCount = relatedEmbeddings.embeddings.length;
        relatedEmbeddings.embeddings = [];
    }
    const messageEmbeddings = conversationData.messageIndexData?.indexData;
    if (messageEmbeddings && messageEmbeddings.embeddings.length > 0) {
        persistentData.embeddings ??= [];
        persistentData.embeddings.push(...messageEmbeddings.embeddings);
        embeddingFileHeader.messageCount = messageEmbeddings.embeddings.length;
        messageEmbeddings.embeddings = [];
    }

    return persistentData;
}

function persistentToConversationData(
    persistentData: PersistedConversationData,
): IConversationDataWithIndexes {
    let embeddingFileHeader = persistentData.conversationData
        .embeddingFileHeader ?? {
        relatedCount: persistentData.embeddings?.length,
    };
    if (persistentData.embeddings) {
        const relatedEmbeddings =
            persistentData.conversationData.relatedTermsIndexData
                ?.textEmbeddingData;
        let startAt = 0;
        if (relatedEmbeddings && embeddingFileHeader.relatedCount) {
            relatedEmbeddings.embeddings = persistentData.embeddings.slice(
                startAt,
                startAt + embeddingFileHeader.relatedCount,
            );
            startAt += embeddingFileHeader.relatedCount;
        }
        const messageEmbeddings =
            persistentData.conversationData.messageIndexData?.indexData;
        if (messageEmbeddings && embeddingFileHeader.messageCount) {
            messageEmbeddings.embeddings = persistentData.embeddings.slice(
                startAt,
                startAt + embeddingFileHeader.messageCount,
            );
        }
    }
    return persistentData.conversationData;
}
