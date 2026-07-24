// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    readFile,
    readJsonFile,
    removeFile,
    writeFile,
    writeJsonFile,
} from "@typeagent/agent-runtime";
import { deserializeEmbeddings, serializeEmbeddings } from "./fuzzyIndex.js";
import path from "path";
import { IConversationDataWithIndexes } from "./secondaryIndexes.js";
import {
    EmbeddingModelMetadata,
    modelMetadata_ada002,
} from "@typeagent/aiclient";

/**
 * Write a conversation's data to files.
 * Persists 2 index files into a directory
 * @param {IConversationDataWithIndexes} conversationData data to persist
 * @param dirPath Directory to write persisted files
 * @param baseFileName Base filename to use for files
 * @param modelMeta Metadata about embedding models used
 */
export async function writeConversationDataToFile(
    conversationData: IConversationDataWithIndexes,
    dirPath: string,
    baseFileName: string,
    modelMeta?: EmbeddingModelMetadata,
): Promise<void> {
    const fileData = toConversationFileData(conversationData, modelMeta);
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
    embeddingSize?: number,
): Promise<IConversationDataWithIndexes | undefined> {
    const jsonData = await readJsonFile<ConversationJsonData>(
        path.join(dirPath, baseFileName + DataFileSuffix),
    );
    if (!jsonData) {
        return undefined;
    }
    const fileData: ConversationFileData = {
        jsonData: jsonData,
        binaryData: {},
    };
    validateFileData(fileData, embeddingSize);
    let embeddings: Float32Array[] | undefined;
    const embeddingsCompatible = arePersistedEmbeddingsCompatible(
        fileData,
        embeddingSize,
    );
    if (
        !embeddingsCompatible &&
        getStoredEmbeddingSize(fileData) !== undefined
    ) {
        console.warn(
            `knowPro: persisted embeddings (size ${getStoredEmbeddingSize(fileData)}) are incompatible with the current embedding model (size ${embeddingSize ?? "none"}). Dropping stored vectors; affected indexes will rebuild.`,
        );
        dropPersistedEmbeddings(fileData.jsonData);
    }
    if (embeddingsCompatible && embeddingSize && embeddingSize > 0) {
        const embeddingsBuffer = await readFile(
            path.join(dirPath, baseFileName + EmbeddingFileSuffix),
        );
        if (embeddingsBuffer) {
            embeddings = deserializeEmbeddings(embeddingsBuffer, embeddingSize);
            fileData.binaryData.embeddings = embeddings;
        }
    }
    fileData.jsonData.fileHeader ??= createFileHeader();
    return fromConversationFileData(fileData);
}

export async function readConversationDataFromBuffer(
    jsonData: string,
    embeddingsBuffer: Buffer,
    embeddingSize: number | undefined,
): Promise<IConversationDataWithIndexes | undefined> {
    if (!jsonData) {
        return undefined;
    }
    let embeddings: Float32Array[] | undefined;
    const fileData: ConversationFileData = {
        jsonData: JSON.parse(jsonData),
        binaryData: {},
    };
    validateFileData(fileData);
    const embeddingsCompatible = arePersistedEmbeddingsCompatible(
        fileData,
        embeddingSize,
    );
    if (
        !embeddingsCompatible &&
        getStoredEmbeddingSize(fileData) !== undefined
    ) {
        console.warn(
            `knowPro: persisted embeddings (size ${getStoredEmbeddingSize(fileData)}) are incompatible with the current embedding model (size ${embeddingSize ?? "none"}). Dropping stored vectors; affected indexes will rebuild.`,
        );
        dropPersistedEmbeddings(fileData.jsonData);
    }
    if (embeddingsCompatible && embeddingSize && embeddingSize > 0) {
        if (embeddingsBuffer) {
            embeddings = deserializeEmbeddings(embeddingsBuffer, embeddingSize);
            fileData.binaryData.embeddings = embeddings;
        }
    }
    fileData.jsonData.fileHeader ??= createFileHeader();
    return fromConversationFileData(fileData);
}

const DataFileSuffix = "_data.json";
const EmbeddingFileSuffix = "_embeddings.bin";

export async function removeConversationData(
    dirPath: string,
    baseFileName: string,
): Promise<void> {
    await removeFile(path.join(dirPath, baseFileName + DataFileSuffix));
    await removeFile(path.join(dirPath, baseFileName + EmbeddingFileSuffix));
}

type ConversationFileData = {
    // This data goes into a JSON text file
    jsonData: ConversationJsonData;
    // This goes into a single binary file
    binaryData: ConversationBinaryData;
};

type FileHeader = {
    version: string;
};

type EmbeddingFileHeader = {
    relatedCount?: number | undefined;
    messageCount?: number | undefined;
    // The V 0.1 file format requires that all embeddings are the same size
    modelMetadata?: EmbeddingModelMetadata | undefined;
};

type EmbeddingData = {
    embeddings: Float32Array[];
};

interface ConversationJsonData extends IConversationDataWithIndexes {
    fileHeader?: FileHeader | undefined;
    embeddingFileHeader?: EmbeddingFileHeader | undefined;
}

type ConversationBinaryData = {
    // This goes into a single binary file
    embeddings?: Float32Array[] | undefined;
};

function validateFileData(
    fileData: ConversationFileData,
    expectedEmbeddingSize?: number | undefined,
): void {
    if (fileData.jsonData === undefined) {
        throw new Error(`${Error_FileCorrupt}: Missing json data`);
    }
}

/**
 * The persisted embedding size, if the file records it.
 */
function getStoredEmbeddingSize(
    fileData: ConversationFileData,
): number | undefined {
    if (fileData.jsonData?.embeddingFileHeader) {
        return (
            fileData.jsonData.embeddingFileHeader.modelMetadata
                ?.embeddingSize ?? modelMetadata_ada002().embeddingSize
        );
    }
    return undefined;
}

/**
 * Returns true when the persisted embeddings can be loaded under the current
 * embedding model. Incompatible (different-dimension) or absent expectations
 * mean we must NOT load the persisted vectors.
 *
 * Persisted embedding indexes are fixed-dimension. When a self-host user
 * switches embedding providers (e.g. Azure 1536-d -> local 384-d), the stored
 * vectors are unusable. Rather than throw at load, we drop the stale vectors
 * and let the affected indexes rebuild / degrade.
 */
function arePersistedEmbeddingsCompatible(
    fileData: ConversationFileData,
    expectedEmbeddingSize?: number | undefined,
): boolean {
    if (!expectedEmbeddingSize || expectedEmbeddingSize <= 0) {
        // No embedding model available now: cannot use persisted vectors.
        return false;
    }
    const storedSize = getStoredEmbeddingSize(fileData);
    if (storedSize === undefined) {
        return true;
    }
    return storedSize === expectedEmbeddingSize;
}

/**
 * Clear persisted embedding vectors and their associated text so downstream
 * deserialization sees consistent (empty) embedding indexes. The indexes will
 * be repopulated the next time the conversation is indexed.
 */
function dropPersistedEmbeddings(jsonData: ConversationJsonData): void {
    if (jsonData.relatedTermsIndexData?.textEmbeddingData) {
        jsonData.relatedTermsIndexData.textEmbeddingData = undefined;
    }
    if (jsonData.messageIndexData?.indexData) {
        jsonData.messageIndexData.indexData = undefined;
    }
    if (jsonData.embeddingFileHeader) {
        jsonData.embeddingFileHeader.relatedCount = undefined;
        jsonData.embeddingFileHeader.messageCount = undefined;
    }
}

function toConversationFileData(
    conversationData: IConversationDataWithIndexes,
    modelMeta?: EmbeddingModelMetadata,
): ConversationFileData {
    const fileData: ConversationFileData = {
        jsonData: {
            ...conversationData,
            fileHeader: createFileHeader(),
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
    const embeddingSize = checkEmbeddingSize(
        fileData,
        modelMeta?.embeddingSize,
    );
    modelMeta ??= { embeddingSize };
    if (modelMeta !== undefined) {
        embeddingFileHeader.modelMetadata = modelMeta;
    }
    return fileData;
}

function createFileHeader(): FileHeader {
    return {
        version: "0.1",
    };
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
    // TODO: Remove this temporary backward compat. All future files should have proper headers
    const embeddingFileHeader = fileData.jsonData.embeddingFileHeader ?? {
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

const Error_FileCorrupt = "Embedding file corrupt";

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
                `${Error_FileCorrupt}: expected ${length}, got ${embeddingData.embeddings.length}`,
            );
        }
        return length;
    }
    return 0;
}

function checkEmbeddingSize(
    fileData: ConversationFileData,
    embeddingSize?: number,
): number {
    if (fileData.binaryData) {
        const embeddings = fileData.binaryData.embeddings;
        if (embeddings && embeddings.length > 0) {
            embeddingSize ??= embeddings[0].length;
            for (let i = 1; i < embeddings.length; ++i) {
                if (embeddingSize !== embeddings[i].length) {
                    throw new Error(
                        `Embeddings not of same size ${embeddingSize}`,
                    );
                }
            }
            return embeddingSize;
        }
    }
    return 0;
}
