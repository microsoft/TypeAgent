// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
    createCandidateEmbeddingModel,
    resolveEmbeddingModel,
    supportsImageEmbeddings,
    tryCreateEmbeddingModel,
    embeddingIdentityKey,
    validateEmbeddingPairing,
    EmbeddingIdentity,
    EmbeddingPart,
    EmbeddingSpacePairing,
    TextEmbeddingModel,
} from "@typeagent/aiclient";
import {
    arg,
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    NamedArgs,
    parseNamedArguments,
} from "interactive-app";
import { EmbeddingGenerationStore, GenerationRecord } from "@typeagent/knowpro";
import {
    MediaEvidenceLane,
    MediaEvidenceLocation,
    MediaEvidenceRecord,
} from "@typeagent/image-memory";
import type { KnowproContext } from "./knowproMemory.js";

function objectValue(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Invalid image evidence metadata");
    }
    return value as Record<string, unknown>;
}

function jsonObject(bytes: Buffer): Record<string, unknown> {
    return objectValue(JSON.parse(bytes.toString("utf8")));
}

function requiredString(value: unknown): string {
    if (typeof value !== "string") {
        throw new Error("Missing image evidence identity field");
    }
    return value;
}

function requiredNumber(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error("Invalid image evidence numeric field");
    }
    return value;
}

function readLocation(input: unknown): MediaEvidenceLocation {
    const value = objectValue(input);
    if (value.kind !== "text" && value.kind !== "image") {
        throw new Error("Invalid image evidence location kind");
    }
    let region: [number, number, number, number] | undefined;
    if (value.region !== undefined) {
        if (!Array.isArray(value.region) || value.region.length !== 4) {
            throw new Error("Invalid image evidence region");
        }
        region = [
            requiredNumber(value.region[0]),
            requiredNumber(value.region[1]),
            requiredNumber(value.region[2]),
            requiredNumber(value.region[3]),
        ];
    }
    const location: MediaEvidenceLocation = { kind: value.kind };
    if (value.assetHash !== undefined) {
        location.assetHash = requiredString(value.assetHash);
    }
    if (value.messageOrdinal !== undefined) {
        location.messageOrdinal = requiredNumber(value.messageOrdinal);
    }
    if (value.chunkOrdinal !== undefined) {
        location.chunkOrdinal = requiredNumber(value.chunkOrdinal);
    }
    if (region !== undefined) {
        location.region = region;
    }
    return location;
}

function readEvidenceRecord(record: GenerationRecord): MediaEvidenceRecord {
    if (!Array.isArray(record.locations) || !Array.isArray(record.vector)) {
        throw new Error("Invalid persisted image lane record");
    }
    return {
        sourceId: record.sourceId,
        revision: record.revision,
        assetHash: requiredString(record.assetHash),
        locations: record.locations.map(readLocation),
        vector: record.vector.map(requiredNumber),
    };
}

function readQueryIdentity(bytes: Buffer): EmbeddingIdentity {
    const value = jsonObject(bytes);
    if (
        value.schemaVersion !== 1 ||
        value.task !== "query" ||
        value.normalization !== "l2" ||
        typeof value.dimensions !== "number"
    ) {
        throw new Error("Invalid image evidence query identity");
    }
    const identity: EmbeddingIdentity = {
        schemaVersion: 1,
        task: "query",
        normalization: "l2",
        dimensions: value.dimensions,
        provider: requiredString(value.provider),
        model: requiredString(value.model),
        revision: requiredString(value.revision),
        prompt: requiredString(value.prompt),
        pooling: requiredString(value.pooling),
        preprocessing: requiredString(value.preprocessing),
        artifactHash: requiredString(value.artifactHash),
    };
    embeddingIdentityKey(identity);
    return identity;
}

async function createImageQueryModel(
    named: NamedArgs,
    identity: EmbeddingIdentity,
): Promise<TextEmbeddingModel> {
    if (named.adapterPath) {
        if (!named.runtimeDir || !named.cacheDir) {
            throw new Error(
                "An external adapter requires runtimeDir and cacheDir",
            );
        }
        return createCandidateEmbeddingModel({
            adapterPath: path.resolve(named.adapterPath),
            runtimeDir: path.resolve(named.runtimeDir),
            cacheDir: path.resolve(named.cacheDir),
            revision: identity.revision,
            localFilesOnly: named.localFilesOnly,
        });
    }
    const model = tryCreateEmbeddingModel();
    if (!model || !supportsImageEmbeddings(model)) {
        throw new Error(
            "Configure embedding.provider: local, runtime: embeddinggemma and modalities: [text, image]",
        );
    }
    return resolveEmbeddingModel(model);
}

export function createImageEvidenceCommands(
    context: KnowproContext,
    commands: Record<string, CommandHandler>,
): void {
    let store: EmbeddingGenerationStore | undefined;
    const loadDefinition: CommandMetadata = {
        description: "Load an opt-in synthetic image evidence generation",
        args: { storePath: arg("Generation store root") },
    };
    commands.kpImagesMediaLoad = async (args: string[]) => {
        const named = parseNamedArguments(args, loadDefinition);
        const candidate = new EmbeddingGenerationStore(
            path.resolve(named.storePath),
        );
        const loaded = await candidate.load();
        if (!loaded.manifest.lanes.pixel) {
            throw new Error("Generation has no native pixel lane");
        }
        store = candidate;
        context.printer.writeLine(
            `Loaded ${loaded.records.length} image evidence records. Approved corpus only; no access-control integration.`,
        );
    };
    commands.kpImagesMediaLoad.metadata = loadDefinition;

    const searchDefinition: CommandMetadata = {
        description: "Search the opt-in pixel lane with text, image or both",
        options: {
            text: arg("Query text"),
            imagePath: arg("Optional native query image"),
            adapterPath: arg("Isolated media adapter module"),
            runtimeDir: arg("Isolated Transformers.js 4.3.1 runtime"),
            cacheDir: arg("Isolated media cache"),
            localFilesOnly: argBool(
                "Require cached artifacts; no downloads",
                true,
            ),
            sourceIds: arg("Optional comma-separated permitted source IDs"),
            maxResults: argNum("Maximum results", 10),
        },
    };
    commands.kpImagesMediaSearch = async (args: string[]) => {
        if (!store) {
            context.printer.writeError("Load an image evidence store first");
            return;
        }
        const named = parseNamedArguments(args, searchDefinition);
        if (!named.text && !named.imagePath) {
            context.printer.writeError("Supply text or imagePath");
            return;
        }
        // Reload on every query so corrections and forgetting cannot reuse an old lane snapshot.
        const loaded = await store.load();
        const queryIdentity = readQueryIdentity(
            loaded.artifacts["query-identity.json"],
        );
        const value = jsonObject(loaded.artifacts["pairing.json"]);
        const pairing: EmbeddingSpacePairing = {
            queryIdentity: requiredString(value.queryIdentity),
            documentIdentity: requiredString(value.documentIdentity),
            evidenceSha256: requiredString(value.evidenceSha256),
        };
        const evidenceHash = createHash("sha256")
            .update(loaded.artifacts["pairing-evidence.json"])
            .digest("hex");
        if (pairing.evidenceSha256 !== evidenceHash) {
            throw new Error("Image pairing evidence hash mismatch");
        }
        const documentIdentity = loaded.manifest.lanes.pixel;
        validateEmbeddingPairing(pairing, queryIdentity, documentIdentity);
        const parts: EmbeddingPart[] = [];
        if (named.text) {
            parts.push({
                type: "text",
                text: named.text + (named.imagePath ? " " : ""),
            });
        }
        let queryAssetHash: string | undefined;
        if (named.imagePath) {
            const bytes = await fs.readFile(named.imagePath);
            queryAssetHash = createHash("sha256").update(bytes).digest("hex");
            const extension = path.extname(named.imagePath).toLowerCase();
            const mimeType =
                extension === ".png"
                    ? "image/png"
                    : extension === ".jpg" || extension === ".jpeg"
                      ? "image/jpeg"
                      : undefined;
            if (!mimeType) {
                throw new Error("Query image must be PNG or JPEG");
            }
            parts.push({
                type: "image",
                bytes,
                sha256: queryAssetHash,
                mimeType,
            });
        }
        const model = await createImageQueryModel(named, queryIdentity);
        try {
            const queryModel = model.forRole!("query");
            if (
                !queryModel.embeddingIdentity ||
                !queryModel.generateMediaEmbeddingBatch
            ) {
                throw new Error(
                    "Configured model did not resolve a media embedding identity",
                );
            }
            if (
                embeddingIdentityKey(queryModel.embeddingIdentity) !==
                embeddingIdentityKey(queryIdentity)
            ) {
                throw new Error(
                    "Live query model differs from saved image lane",
                );
            }
            const result = await queryModel.generateMediaEmbeddingBatch([
                parts,
            ]);
            if (!result.success) {
                context.printer.writeError(result.message);
                return;
            }
            const lane = new MediaEvidenceLane(
                documentIdentity,
                loaded.records.map(readEvidenceRecord),
            );
            const hits = lane.search({
                identity: queryIdentity,
                vector: result.data[0],
                kind: named.imagePath
                    ? named.text
                        ? "mixed"
                        : "image"
                    : "text",
                pairing,
                sourceIds: named.sourceIds?.split(","),
                ...(queryAssetHash === undefined
                    ? {}
                    : { excludeAssetHash: queryAssetHash }),
                maxResults: named.maxResults,
            });
            const records = new Map(
                loaded.records.map((record) => [record.sourceId, record]),
            );
            context.printer.writeLine(
                JSON.stringify(
                    hits.map((hit) => ({
                        ...hit,
                        contributingLane: "native-pixels",
                        origin: records.get(hit.sourceId)?.origin,
                    })),
                    undefined,
                    2,
                ),
            );
        } finally {
            await model.dispose?.();
        }
    };
    commands.kpImagesMediaSearch.metadata = searchDefinition;
}
