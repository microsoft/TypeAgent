// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kpLib from "@typeagent/knowledge-processor";
import * as kp from "@typeagent/knowpro";
import * as ms from "@typeagent/memory-storage";
import {
    embeddingIdentityKey,
    embeddingModelForRole,
    getEmbeddingSize,
    resolveEmbeddingModel,
    TextEmbeddingModel,
    tryCreateEmbeddingModel,
} from "@typeagent/aiclient";
import { IndexFileSettings, IndexingState } from "./memory.js";

export function createEmbeddingModelWithCache(
    cacheSize: number,
    getCache?: () => kpLib.TextEmbeddingCache | undefined,
    embeddingSize?: number,
): [kpLib.TextEmbeddingModelWithCache | undefined, number] {
    // May be undefined when no embedding provider is configured (e.g. Copilot
    // self-host without a local embedder). Memory then indexes/searches with
    // exact + alias + edit-distance matching and skips embedding-only features.
    const innerModel = tryCreateEmbeddingModel();
    if (innerModel === undefined) {
        return [undefined, embeddingSize ?? getEmbeddingSize()];
    }
    const embeddingModel = kpLib.createEmbeddingCache(
        innerModel,
        cacheSize,
        getCache,
    );

    return [
        embeddingModel,
        embeddingModel.embeddingIdentity?.dimensions ??
            embeddingSize ??
            getEmbeddingSize(),
    ];
}

/**
 * Synchronous factories can create settings before a local runtime is ready.
 * Resolve each configured lane before it is used or its identity is persisted.
 * Empty identities deliberately mean "unknown", never an attested default.
 */
export async function prepareConversationEmbeddings(
    settings: kp.ConversationSettings,
): Promise<kp.PersistedEmbeddingIdentities> {
    const identities: kp.PersistedEmbeddingIdentities = {};
    let complete = true;
    const lanes = {
        relatedTerms: settings.relatedTermIndexSettings.embeddingIndexSettings,
        message: settings.messageTextIndexSettings.embeddingIndexSettings,
        thread: settings.threadSettings,
    };
    const resolutions = new Map<
        NonNullable<typeof settings.threadSettings.embeddingModel>,
        Promise<NonNullable<typeof settings.threadSettings.embeddingModel>>
    >();
    for (const [lane, indexSettings] of Object.entries(lanes)) {
        if (!indexSettings?.embeddingModel) continue;
        const original = indexSettings.embeddingModel;
        let resolution = resolutions.get(original);
        if (!resolution) {
            resolution = resolveEmbeddingModel(original);
            resolutions.set(original, resolution);
        }
        const model = await resolution;
        indexSettings.embeddingModel = model;
        let dimensions: number | undefined;
        for (const role of ["query", "document"] as const) {
            const identity = embeddingModelForRole(
                model,
                role,
            ).embeddingIdentity;
            if (!identity) {
                complete = false;
                continue;
            }
            embeddingIdentityKey(identity);
            if (
                dimensions !== undefined &&
                dimensions !== identity.dimensions
            ) {
                throw new Error("Embedding model role dimensions disagree");
            }
            dimensions = identity.dimensions;
            indexSettings.embeddingSize = identity.dimensions;
            identities[`${lane}.${role}`] = identity;
        }
    }
    const dimensions = new Set(
        Object.values(lanes).flatMap((lane) =>
            lane?.embeddingModel ? [lane.embeddingSize] : [],
        ),
    );
    if (dimensions.size > 1) {
        throw new Error(
            "Conversation embedding lanes must use the same dimensions for the shared vector file.",
        );
    }
    return complete ? identities : {};
}

export async function writeMemoryDataToFile(
    data: kp.IConversationDataWithIndexes,
    settings: kp.ConversationSettings,
    dirPath: string,
    baseFileName: string,
): Promise<void> {
    const identities = await prepareConversationEmbeddings(settings);
    await kp.writeConversationDataToFile(
        data,
        dirPath,
        baseFileName,
        undefined,
        Object.keys(identities).length > 0 ? identities : undefined,
    );
}

export function synchronizeEmbeddingIndexSettings(
    conversation: kp.IConversation,
    settings: kp.ConversationSettings,
): void {
    // TermEmbeddingIndex copies settings to pin its document lookup role.
    // Keep that copy aligned when lazy resolution returns a new model.
    const fuzzyIndex =
        conversation.secondaryIndexes?.termToRelatedTermsIndex?.fuzzyIndex;
    const configured = settings.relatedTermIndexSettings.embeddingIndexSettings;
    if (fuzzyIndex instanceof kp.TermEmbeddingIndex && configured) {
        fuzzyIndex.settings.embeddingModel = configured.embeddingModel;
        fuzzyIndex.settings.embeddingSize = configured.embeddingSize;
    }
}

export class ConversationEmbeddingState {
    private key: string | undefined;
    private models: (TextEmbeddingModel | undefined)[] | undefined;

    public async prepare(
        settings: kp.ConversationSettings,
        conversation: kp.IConversation,
        rebuilding: boolean = false,
    ): Promise<kp.PersistedEmbeddingIdentities> {
        const identities = await prepareConversationEmbeddings(settings);
        const size =
            settings.messageTextIndexSettings.embeddingIndexSettings
                .embeddingSize;
        const key = JSON.stringify([
            size,
            Object.entries(identities).map(([lane, identity]) => [
                lane,
                embeddingIdentityKey(identity),
            ]),
        ]);
        const models = [
            settings.relatedTermIndexSettings.embeddingIndexSettings
                ?.embeddingModel,
            settings.messageTextIndexSettings.embeddingIndexSettings
                .embeddingModel,
            settings.threadSettings.embeddingModel,
        ];
        const previousModels = this.models;
        const unknownModelChanged =
            Object.keys(identities).length === 0 &&
            previousModels !== undefined &&
            models.some((model, index) => model !== previousModels[index]);
        if (
            !rebuilding &&
            ((this.key !== undefined && this.key !== key) ||
                unknownModelChanged)
        ) {
            throw new Error(
                "Embedding model changed. Rebuild all embeddings before indexing, saving, or searching this memory.",
            );
        }
        this.key = key;
        this.models = models;
        synchronizeEmbeddingIndexSettings(conversation, settings);
        return identities;
    }
}

export async function readMemoryDataFromFile(
    settings: kp.ConversationSettings,
    dirPath: string,
    baseFileName: string,
    options?: { loadEmbeddings?: boolean },
): Promise<kp.IConversationDataWithIndexes | undefined> {
    const identities = await prepareConversationEmbeddings(settings);
    return kp.readConversationDataFromFile(
        dirPath,
        baseFileName,
        settings.messageTextIndexSettings.embeddingIndexSettings.embeddingSize,
        identities,
        options,
    );
}

export function createIndexingState(): IndexingState {
    return {
        lastMessageOrdinal: -1,
        lastSemanticRefOrdinal: -1,
    };
}

export function getIndexingErrors(
    results: kp.IndexingResults,
): string | undefined {
    let error = "";
    error += getIndexingError(results.semanticRefs);
    error += getIndexingError(results.secondaryIndexResults?.message);
    error += getIndexingError(results.secondaryIndexResults?.properties);
    error += getIndexingError(results.secondaryIndexResults?.relatedTerms);
    error += getIndexingError(results.secondaryIndexResults?.timestamps);
    return error.length > 0 ? error : undefined;
}

function getIndexingError(result: kp.TextIndexingResult | undefined) {
    return result?.error ? result.error + "\n" : "";
}

export function addAliasesForName(
    aliases: kp.TermToRelatedTermsMap,
    name: string,
    addLastName: boolean,
) {
    name = name.toLocaleLowerCase();
    const parsedName = kpLib.conversation.splitParticipantName(name);
    if (parsedName && parsedName.firstName && parsedName.lastName) {
        // If participantName is a full name, then associate firstName with the full name
        aliases.addRelatedTerm(parsedName.firstName, { text: name });
        aliases.addRelatedTerm(name, { text: parsedName.firstName });
        if (addLastName) {
            aliases.addRelatedTerm(parsedName.lastName, { text: name });
            aliases.addRelatedTerm(name, { text: parsedName.lastName });
        }
    }
}

export function getCollectionData<T>(
    collection: kp.ICollection<T>,
    forExport: boolean,
): T[] {
    return forExport || !collection.isPersistent ? collection.getAll() : [];
}

export function createStorageProvider(
    fileSettings: IndexFileSettings,
    useSqlite: boolean = true,
): kp.IStorageProvider {
    const storageProvider = useSqlite
        ? ms.sqlite.createSqlStorageProvider(
              fileSettings.dirPath,
              fileSettings.baseFileName,
              false,
          )
        : new kp.MemoryStorageProvider();
    return storageProvider;
}
