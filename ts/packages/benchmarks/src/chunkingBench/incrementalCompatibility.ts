// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
    embeddingIdentityKey,
    embeddingModelForRole,
    resolveEmbeddingModel,
    type EmbeddingIdentity,
} from "@typeagent/aiclient";
import { createBenchmarkEmbeddingModel } from "@typeagent/memory-service/benchmark";
import {
    bytesHash,
    digest,
    list,
    object,
    readJson,
    string,
    text,
} from "../memoryBench/storage.js";
import type { FrozenInput } from "./incrementalSnapshots.js";
import type { SourceMap } from "./retrievers.js";
import { validateSourceMap } from "./runner.js";

async function segmentValue(index: string, hash: string): Promise<unknown> {
    if (!/^[a-f0-9]{64}$/u.test(hash))
        throw new Error("Invalid index metadata segment identity");
    const bytes = await readFile(path.join(index, ".segments", `${hash}.json`));
    if (bytesHash(bytes) !== hash)
        throw new Error("Index metadata segment hash mismatch");
    const node = object(JSON.parse(bytes.toString("utf8")));
    if (node.kind === "value") return node.value;
    if (node.kind === "publication")
        return segmentValue(index, text(node.child));
    if (node.kind === "items" || node.kind === "chunks") {
        const values = await Promise.all(
            list(node.children).map((child) =>
                segmentValue(index, text(child)),
            ),
        );
        return node.kind === "chunks" ? values.flatMap(list) : values;
    }
    if (node.kind !== "object" || !Array.isArray(node.entries))
        throw new Error("Unsupported native embedding metadata schema");
    const pairs = await Promise.all(
        node.entries.map(async (entry: unknown) => {
            if (!Array.isArray(entry) || entry.length !== 2)
                throw new Error("Invalid index metadata node");
            return [
                text(entry[0]),
                await segmentValue(index, text(entry[1])),
            ] as const;
        }),
    );
    return Object.fromEntries(pairs);
}

async function indexProperty(file: string, property: string) {
    const descriptor = object(await readJson(file));
    if (descriptor.segmentedJsonVersion === undefined)
        return descriptor[property];
    if (
        descriptor.segmentedJsonVersion !== 1 &&
        descriptor.segmentedJsonVersion !== 2
    )
        throw new Error("Unsupported native segmented index schema");
    const index = path.dirname(path.dirname(file));
    async function child(hash: string, property: string): Promise<string> {
        if (!/^[a-f0-9]{64}$/u.test(hash))
            throw new Error("Invalid index metadata root identity");
        const bytes = await readFile(
            path.join(index, ".segments", `${hash}.json`),
        );
        if (bytesHash(bytes) !== hash)
            throw new Error("Index root hash mismatch");
        const node = object(JSON.parse(bytes.toString("utf8")));
        if (node.kind === "publication")
            return child(text(node.child), property);
        const entries = node.entries;
        if (node.kind !== "object" || !Array.isArray(entries))
            throw new Error("Unsupported index root schema");
        const pair = entries.find(
            (pair: unknown) => Array.isArray(pair) && pair[0] === property,
        );
        if (!Array.isArray(pair))
            throw new Error(`Missing native index metadata: ${property}`);
        return text(pair[1]);
    }
    const data = await child(text(descriptor.root), "jsonData");
    const header = await child(data, property);
    return segmentValue(index, header);
}

export async function verifyPersistedEmbeddingIdentities(
    store: string,
    current: { query: EmbeddingIdentity; document: EmbeddingIdentity },
) {
    const verified: { file: string; identities: unknown }[] = [];
    async function verifyHeader(file: string) {
        const header = object(await indexProperty(file, "embeddingFileHeader"));
        const identities = object(header.identities);
        for (const [lane, value] of Object.entries(identities)) {
            const role = lane.endsWith(".query")
                ? "query"
                : lane.endsWith(".document")
                  ? "document"
                  : undefined;
            if (
                !role ||
                embeddingIdentityKey(value as EmbeddingIdentity) !==
                    embeddingIdentityKey(current[role])
            )
                throw new Error(
                    `Persisted native embedding identity incompatible at ${path.relative(store, file)} (${lane}); no vector rebuild/reingestion authorized`,
                );
        }
        if (
            !identities["message.query"] ||
            !identities["message.document"] ||
            !identities["relatedTerms.query"] ||
            !identities["relatedTerms.document"]
        )
            throw new Error(
                "Persisted native embedding identity lanes are incomplete",
            );
        verified.push({ file: path.relative(store, file), identities });
    }
    async function scan(directory: string) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (entry.name === ".segments") continue;
            const file = path.join(directory, entry.name);
            if (entry.isSymbolicLink())
                throw new Error("Native snapshot contains a link");
            if (entry.isDirectory()) await scan(file);
            else if (entry.name === "index-schema.json") {
                const schema = object(await readJson(file));
                if (
                    schema.indexSchemaVersion !== 1 ||
                    schema.engine !== "knowpro" ||
                    !["documents", "views"].includes(String(schema.indexKind))
                )
                    throw new Error(`Unsupported native index schema: ${file}`);
            } else if (entry.name === "corpus_data.json")
                await verifyHeader(file);
        }
    }
    await scan(store);
    if (!verified.length)
        throw new Error(
            "Frozen native snapshot has no verifiable embedding metadata",
        );
    return {
        current,
        verified,
        compatibility:
            "exact-role-identity-and-supported-index-schema; no-rebuild",
    };
}

export async function verifyConfiguredEmbeddingCompatibility(store: string) {
    const configured = createBenchmarkEmbeddingModel();
    if (!configured)
        throw new Error(
            "Native snapshot reuse requires an identified configured embedding provider",
        );
    const model = await resolveEmbeddingModel(configured);
    try {
        const query = embeddingModelForRole(model, "query").embeddingIdentity;
        const document = embeddingModelForRole(
            model,
            "document",
        ).embeddingIdentity;
        if (!query || !document)
            throw new Error(
                "Configured native embedding identities are unavailable",
            );
        return await verifyPersistedEmbeddingIdentities(store, {
            query,
            document,
        });
    } finally {
        await model.dispose?.();
    }
}

async function walkPersistedRawSourceMaps(
    store: string,
    input: Pick<FrozenInput, "identities" | "documents">,
    maps: Record<string, SourceMap>,
    collect = false,
) {
    const seen = new Map<string, { ordinal: number; position: number }>();
    async function readMessages(file: string, corpusId: string) {
        for (const value of list(await indexProperty(file, "messages"))) {
            const message = object(value);
            const uri = text(object(message.metadata).sourceUrl);
            const match =
                /^typeagent-memory:\/\/sources\/([^/]+)\/revisions\/([^/]+)$/u.exec(
                    uri,
                );
            const identity =
                match &&
                input.identities.find(
                    (item) =>
                        item.corpusId === corpusId &&
                        item.sourceId === match[1],
                );
            if (!identity || !match)
                throw new Error(
                    "Persisted raw DocPart escaped the frozen corpus/source map",
                );
            const map = maps[identity.documentId];
            const cursor = seen.get(identity.documentId) ?? {
                ordinal: 0,
                position: 0,
            };
            const raw = list(message.textChunks).map(string).join("\n");
            const expected = collect
                ? {
                      start: cursor.position,
                      end: cursor.position + raw.length,
                      sha256: bytesHash(raw),
                  }
                : map.blocks[cursor.ordinal];
            if (collect) map.blocks.push(expected);
            const doc = input.documents.find(
                (doc) => doc.id === identity.documentId,
            )!;
            if (
                map.revisionId !== match[2] ||
                !expected ||
                expected.start !== cursor.position ||
                expected.end !== cursor.position + raw.length ||
                expected.sha256 !== bytesHash(raw) ||
                doc.text.slice(expected.start, expected.end) !== raw
            )
                throw new Error(
                    `Persisted raw DocPart/revision differs from canonical source map: ${identity.documentId}:${cursor.ordinal}`,
                );
            seen.set(identity.documentId, {
                ordinal: cursor.ordinal + 1,
                position: expected.end,
            });
        }
    }
    for (const corpusId of new Set(
        input.identities.map((item) => item.corpusId),
    )) {
        const directory = path.join(store, corpusId, "index");
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (entry.name === ".segments") continue;
            if (!entry.isDirectory() || entry.isSymbolicLink())
                throw new Error("Unsupported original native index directory");
            const schema = object(
                await readJson(
                    path.join(directory, entry.name, "index-schema.json"),
                ),
            );
            if (
                schema.engine !== "knowpro" ||
                schema.indexSchemaVersion !== 1 ||
                schema.indexKind !== "documents"
            )
                throw new Error("Original source index schema is unsupported");
            await readMessages(
                path.join(directory, entry.name, "corpus_data.json"),
                corpusId,
            );
        }
    }
    for (const identity of input.identities) {
        const cursor = seen.get(identity.documentId);
        const map = maps[identity.documentId];
        if (
            cursor?.ordinal !== map.blocks.length ||
            cursor.position !== map.totalChars
        )
            throw new Error(
                `Incomplete persisted raw source-map coverage: ${identity.documentId}`,
            );
    }
    return {
        originalDocPartsVerified: true,
        sourceMapsDigest: digest(maps),
        sources: seen.size,
    };
}

export async function verifyPersistedRawSourceMaps(
    store: string,
    input: Pick<FrozenInput, "identities" | "documents">,
    maps: Record<string, SourceMap>,
) {
    return walkPersistedRawSourceMaps(store, input, maps);
}

export async function loadFrozenIndexedMaps(
    store: string,
    input: Pick<FrozenInput, "identities" | "documents">,
) {
    const maps: Record<string, SourceMap> = {};
    for (const identity of input.identities) {
        const manifest = object(
            await readJson(
                path.join(store, identity.corpusId, "manifest.json"),
            ),
        );
        const source = list(manifest.sources)
            .map(object)
            .find((s) => s.sourceId === identity.sourceId);
        const revision =
            source &&
            list(source.revisions)
                .map(object)
                .find(
                    (r) =>
                        r.revisionId === source.activeRevisionId &&
                        r.state === "ready",
                );
        if (!source || source.sourceType !== "text" || !revision)
            throw new Error(
                `Frozen native source has no active ready text revision: ${identity.documentId}`,
            );
        const doc = input.documents.find(
            (doc) => doc.id === identity.documentId,
        )!;
        maps[doc.id] = {
            sourceId: identity.sourceId,
            revisionId: text(revision.revisionId),
            contentHash: bytesHash(doc.text),
            totalChars: doc.text.length,
            blocks: [],
        };
    }
    await walkPersistedRawSourceMaps(store, input, maps, true);
    for (const doc of input.documents)
        validateSourceMap(maps[doc.id], doc.text);
    return maps;
}
