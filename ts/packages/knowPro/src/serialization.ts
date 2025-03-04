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
    if (serializationData.embeddings) {
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
    let serializationData: IPersistedConversationData = {
        conversationData,
        embeddings,
    };
    return persistentToConversationData(serializationData);
}

const DataFileSuffix = "_data.json";
const EmbeddingFileSuffix = "_embeddings.bin";

interface IPersistedConversationData {
    conversationData: IConversationDataWithIndexes;
    embeddings?: Float32Array[] | undefined;
}

function conversationDataToPersistent(
    conversationData: IConversationDataWithIndexes,
): IPersistedConversationData {
    let persistentData: IPersistedConversationData = {
        conversationData,
    };
    const embeddingData =
        conversationData.relatedTermsIndexData?.textEmbeddingData;
    if (embeddingData) {
        persistentData.embeddings = embeddingData.embeddings;
        embeddingData.embeddings = [];
    }
    return persistentData;
}

function persistentToConversationData(
    persistentData: IPersistedConversationData,
): IConversationDataWithIndexes {
    const embeddingData =
        persistentData.conversationData.relatedTermsIndexData
            ?.textEmbeddingData;
    if (persistentData.embeddings && embeddingData) {
        embeddingData.embeddings = persistentData.embeddings;
    }
    return persistentData.conversationData;
}
