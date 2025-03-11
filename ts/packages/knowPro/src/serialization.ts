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
    const fileData = toConversationFileData(conversationData);
    if (fileData.binaryData) {
        if (
            fileData.binaryData.embeddings &&
            fileData.binaryData.embeddings.length > 0
        ) {
            const embeddingsBuffer = serializeEmbeddings(
                fileData.binaryData.embeddings,
            );
            await writeFile(
                path.join(dirPath, baseFileName + EmbeddingFileSuffix),
                embeddingsBuffer,
            );
        }
    }
    await writeJsonFile(
        path.join(dirPath, baseFileName + DataFileSuffix),
        fileData.jsonData,
    );
}

export async function readConversationDataFromFile(
    dirPath: string,
    baseFileName: string,
    embeddingSize: number | undefined,
): Promise<IConversationDataWithIndexes | undefined> {
    const jsonData = await readJsonFile<ConversationJsonData>(
        path.join(dirPath, baseFileName + DataFileSuffix),
    );
    if (!jsonData) {
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
    let serializationData: ConversationFileData = {
        jsonData: jsonData,
        binaryData: { embeddings },
    };
    return fromConversationFileData(serializationData);
}

const DataFileSuffix = "_data.json";
const EmbeddingFileSuffix = "_embeddings.bin";

type ConversationFileData = {
    // This data goes into a JSON text file
    jsonData: ConversationJsonData;
    // This goes into a single binary file
    binaryData: ConversationBinaryData;
};

type EmbeddingFileHeader = {
    relatedCount?: number | undefined;
    messageCount?: number | undefined;
};

type EmbeddingData = {
    embeddings: Float32Array[];
};

interface ConversationJsonData extends IConversationDataWithIndexes {
    embeddingFileHeader?: EmbeddingFileHeader | undefined;
}

type ConversationBinaryData = {
    // This goes into a single binary file
    embeddings?: Float32Array[] | undefined;
};

function toConversationFileData(
    conversationData: IConversationDataWithIndexes,
): ConversationFileData {
    let fileData: ConversationFileData = {
        jsonData: {
            ...conversationData,
            embeddingFileHeader: {},
        },
        binaryData: {},
    };
    const embeddingFileHeader = fileData.jsonData.embeddingFileHeader!;
    embeddingFileHeader.relatedCount = addEmbeddingsToBinaryData(
        fileData.binaryData,
        conversationData.relatedTermsIndexData?.textEmbeddingData,
    );
    embeddingFileHeader.messageCount = addEmbeddingsToBinaryData(
        fileData.binaryData,
        conversationData.messageIndexData?.indexData,
    );

    return fileData;
}

function addEmbeddingsToBinaryData(
    binaryData: ConversationBinaryData,
    embeddingData?: EmbeddingData | undefined,
): number | undefined {
    let lengthPushed: number | undefined;
    if (
        embeddingData &&
        embeddingData.embeddings &&
        embeddingData.embeddings.length > 0
    ) {
        binaryData.embeddings ??= [];
        binaryData.embeddings.push(...embeddingData.embeddings);
        lengthPushed = embeddingData.embeddings.length;
        embeddingData.embeddings = [];
    }
    return lengthPushed;
}

function fromConversationFileData(
    fileData: ConversationFileData,
): IConversationDataWithIndexes {
    let embeddingFileHeader = fileData.jsonData.embeddingFileHeader ?? {
        relatedCount:
            fileData.jsonData.relatedTermsIndexData?.textEmbeddingData
                ?.textItems.length,
    };
    if (fileData.binaryData) {
        let startAt = 0;
        startAt += getEmbeddingsFromBinaryData(
            fileData.binaryData,
            fileData.jsonData.relatedTermsIndexData?.textEmbeddingData,
            startAt,
            embeddingFileHeader.relatedCount,
        );
        startAt += getEmbeddingsFromBinaryData(
            fileData.binaryData,
            fileData.jsonData.messageIndexData?.indexData,
            startAt,
            embeddingFileHeader.messageCount,
        );
    }
    return fileData.jsonData;
}

function getEmbeddingsFromBinaryData(
    binaryData: ConversationBinaryData,
    embeddingData: EmbeddingData | undefined,
    startAt: number,
    length?: number | undefined,
): number {
    if (binaryData.embeddings && embeddingData && length && length > 0) {
        embeddingData.embeddings = binaryData.embeddings.slice(
            startAt,
            startAt + length,
        );
        if (embeddingData.embeddings.length !== length) {
            throw new Error(
                `Embedding file corrupt: expected ${length}, got ${embeddingData.embeddings.length}`,
            );
        }
        return length;
    }
    return 0;
}
