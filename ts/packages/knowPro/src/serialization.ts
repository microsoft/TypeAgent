// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile, readJsonFile, writeFile, writeJsonFile } from "typeagent";
import { deserializeEmbeddings, serializeEmbeddings } from "./fuzzyIndex.js";
import { IConversation, IConversationData } from "./interfaces.js";
import path from "path";

export interface IPersistedConversationData<T extends IConversationData> {
    conversationData: T;
    embeddings?: Float32Array[] | undefined;
}

export async function writeConversationToFile<T extends IConversationData>(
    conversation: IConversation,
    dirPath: string,
    baseFileName: string,
    serializer: (
        conversation: IConversation,
    ) => Promise<IPersistedConversationData<T>>,
): Promise<void> {
    const serializationData = await serializer(conversation);
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

export async function readConversationFromFile<T extends IConversationData>(
    dirPath: string,
    baseFileName: string,
    embeddingSize: number | undefined,
    deserializer: (
        data: IPersistedConversationData<T>,
    ) => Promise<IConversation>,
): Promise<IConversation | undefined> {
    const conversationData = await readJsonFile<T>(
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
    let serializationData: IPersistedConversationData<T> = {
        conversationData,
        embeddings,
    };
    return deserializer(serializationData);
}

const DataFileSuffix = "_data.json";
const EmbeddingFileSuffix = "_embeddings.bin";
