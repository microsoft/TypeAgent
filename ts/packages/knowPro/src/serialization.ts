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
    EmbeddingIdentity,
    embeddingIdentityKey,
    validateEmbeddingVector,
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
    conversationData: EmbeddingIdentifiedConversationData,
    dirPath: string,
    baseFileName: string,
    modelMeta?: EmbeddingModelMetadata,
    identities?: PersistedEmbeddingIdentities,
): Promise<void> {
    identities ??= (conversationData as EmbeddingIdentifiedConversationData)
        .embeddingIdentities;
    const fileData = toConversationFileData(conversationData, modelMeta);
    if (identities) {
        validateIdentities(identities);
        validateIdentityVectors(fileData, identities);
        fileData.jsonData.embeddingFileHeader!.identities = identities;
    }
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
    expectedIdentities?: PersistedEmbeddingIdentities,
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
    checkIdentities(fileData, expectedIdentities, embeddingSize);
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
    if (expectedIdentities)
        validateIdentityVectors(fileData, expectedIdentities, true);
    return fromConversationFileData(fileData);
}

export async function readConversationDataFromBuffer(
    jsonData: string,
    embeddingsBuffer: Buffer,
    embeddingSize: number | undefined,
    expectedIdentities?: PersistedEmbeddingIdentities,
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
    checkIdentities(fileData, expectedIdentities, embeddingSize);
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
    if (expectedIdentities)
        validateIdentityVectors(fileData, expectedIdentities, true);
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
    identities?: PersistedEmbeddingIdentities;
    relatedCount?: number | undefined;
    messageCount?: number | undefined;
    // The V 0.1 file format requires that all embeddings are the same size
    modelMetadata?: EmbeddingModelMetadata | undefined;
};

export type PersistedEmbeddingIdentities = Record<string, EmbeddingIdentity>;

export type EmbeddingIdentifiedConversationData<TMessage = unknown> =
    IConversationDataWithIndexes<TMessage> & {
        embeddingIdentities?: PersistedEmbeddingIdentities | undefined;
    };

export function validateConversationEmbeddingIdentities(
    data: IConversationDataWithIndexes,
    expected: PersistedEmbeddingIdentities,
    embeddingSize: number,
): void {
    checkIdentities(
        { jsonData: data, binaryData: {} },
        expected,
        embeddingSize,
    );
}

export class PersistedEmbeddingIdentityError extends Error {
    constructor(
        public readonly conversationData: IConversationDataWithIndexes,
    ) {
        super(
            "Persisted embedding identity is unknown or incompatible. Rebuild all embeddings with the configured model (DocMemory.readFromFile(..., settings, { rebuildEmbeddings: true })); extraction is not required. Source text and structured knowledge remain available in conversationData.",
        );
        this.name = "PersistedEmbeddingIdentityError";
    }
}

function validateIdentities(identities: PersistedEmbeddingIdentities): void {
    if (Object.keys(identities).length === 0)
        throw new Error("Embedding lane identities must not be empty");
    Object.values(identities).forEach(embeddingIdentityKey);
}

function checkIdentities(
    fileData: ConversationFileData,
    expected?: PersistedEmbeddingIdentities,
    embeddingSize?: number,
): void {
    if (!expected) return;
    if (!hasPersistedEmbeddingVectors(fileData.jsonData)) return;
    if (Object.keys(expected).length > 0) validateIdentities(expected);
    const stored =
        fileData.jsonData.embeddingFileHeader?.identities ??
        fileData.jsonData.embeddingIdentities;
    const storedSize = getStoredEmbeddingSize(fileData);
    if (
        Object.keys(expected).length === 0 ||
        (storedSize !== undefined && storedSize !== embeddingSize) ||
        Object.values(expected).some(
            (identity) => identity.dimensions !== embeddingSize,
        ) ||
        !stored ||
        Object.entries(expected).some(
            ([lane, identity]) =>
                !stored[lane] || !sameEmbeddingIdentity(stored[lane], identity),
        )
    ) {
        const source = cloneIndexData(fileData.jsonData);
        dropPersistedEmbeddings(source);
        throw new PersistedEmbeddingIdentityError(source);
    }
}

function hasPersistedEmbeddingVectors(data: ConversationJsonData): boolean {
    const header = data.embeddingFileHeader;
    const related = data.relatedTermsIndexData?.textEmbeddingData;
    const messages = data.messageIndexData?.indexData;
    return Boolean(
        header?.relatedCount ||
            header?.messageCount ||
            related?.textItems.length ||
            messages?.textLocations.length ||
            data.threadData?.threads?.some(
                (thread) => thread.embedding.length > 0,
            ),
    );
}

function sameEmbeddingIdentity(
    stored: EmbeddingIdentity,
    expected: EmbeddingIdentity,
): boolean {
    try {
        return embeddingIdentityKey(stored) === embeddingIdentityKey(expected);
    } catch {
        return false;
    }
}

function validateIdentityVectors(
    fileData: ConversationFileData,
    identities: PersistedEmbeddingIdentities,
    requireComplete = false,
): void {
    const vectors = fileData.binaryData.embeddings ?? [];
    const header = fileData.jsonData.embeddingFileHeader;
    const count = (header?.relatedCount ?? 0) + (header?.messageCount ?? 0);
    if (requireComplete && count !== vectors.length) {
        throw new Error(
            `${Error_FileCorrupt}: missing or incomplete embedding artifact`,
        );
    }
    for (const identity of Object.values(identities)) {
        for (const vector of vectors) {
            validateEmbeddingVector(Array.from(vector), identity.dimensions);
        }
    }
    const threadIdentity = identities["thread.document"];
    if (threadIdentity) {
        for (const thread of fileData.jsonData.threadData?.threads ?? []) {
            if (thread.embedding.length > 0) {
                validateEmbeddingVector(
                    thread.embedding,
                    threadIdentity.dimensions,
                );
            }
        }
    }
}

type EmbeddingData = {
    embeddings: Float32Array[];
};

interface ConversationJsonData extends IConversationDataWithIndexes {
    embeddingIdentities?: PersistedEmbeddingIdentities;
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
                ?.embeddingSize ??
            Object.values(
                fileData.jsonData.embeddingFileHeader.identities ?? {},
            )[0]?.dimensions ??
            modelMetadata_ada002().embeddingSize
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
        jsonData.messageIndexData.messageCount = 0;
    }
    for (const thread of jsonData.threadData?.threads ?? []) {
        thread.embedding = [];
    }
    if (jsonData.embeddingFileHeader) {
        jsonData.embeddingFileHeader.relatedCount = undefined;
        jsonData.embeddingFileHeader.messageCount = undefined;
    }
}

function cloneIndexData(data: ConversationJsonData): ConversationJsonData {
    return {
        ...data,
        embeddingFileHeader: data.embeddingFileHeader
            ? { ...data.embeddingFileHeader }
            : undefined,
        relatedTermsIndexData: data.relatedTermsIndexData
            ? { ...data.relatedTermsIndexData }
            : undefined,
        messageIndexData: data.messageIndexData
            ? { ...data.messageIndexData }
            : undefined,
        threadData: data.threadData
            ? {
                  threads: data.threadData.threads?.map((thread) => ({
                      ...thread,
                  })),
              }
            : undefined,
    };
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
    const related = conversationData.relatedTermsIndexData;
    if (related?.textEmbeddingData) {
        fileData.jsonData.relatedTermsIndexData = {
            ...related,
            textEmbeddingData: { ...related.textEmbeddingData },
        };
    }
    const messages = conversationData.messageIndexData;
    if (messages?.indexData) {
        fileData.jsonData.messageIndexData = {
            ...messages,
            indexData: { ...messages.indexData },
        };
    }
    const embeddingFileHeader = fileData.jsonData.embeddingFileHeader!;
    embeddingFileHeader.relatedCount = addEmbeddingsToBinaryData(
        fileData.binaryData,
        fileData.jsonData.relatedTermsIndexData?.textEmbeddingData,
    );
    embeddingFileHeader.messageCount = addEmbeddingsToBinaryData(
        fileData.binaryData,
        fileData.jsonData.messageIndexData?.indexData,
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
            for (let i = 0; i < embeddings.length; ++i) {
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
