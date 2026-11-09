// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DocMemory,
    createDocMemorySettings,
    splitDocPartTextForEmbedding,
    type DocMemorySettings,
} from "@typeagent/conversation-memory";
import { isSegmentedJson } from "@typeagent/knowpro";
import {
    cp,
    lstat,
    mkdir,
    readFile,
    readdir,
    realpath,
    rm,
} from "node:fs/promises";
import path from "node:path";
import { KnowProCorpusIndex } from "./knowProCorpusIndex.js";
import { classifyIndexSchema, indexFingerprint } from "./indexSchema.js";

/**
 * Prepare one offline service index in a new directory. Never activate it or
 * modify the original; the caller must stop writers and retain a rollback copy.
 */
export async function prepareEmbeddingIndexMigration(
    sourceDirectory: string,
    outputDirectory: string,
    settings?: DocMemorySettings,
): Promise<{
    outputDirectory: string;
    indexKind: "documents" | "conversation-events" | "views";
    messageCount: number;
    semanticRefCount: number;
}> {
    const source = await realpath(sourceDirectory);
    const output = path.resolve(outputDirectory);
    const destination = path.join(
        await realpath(path.dirname(output)),
        path.basename(output),
    );
    const relative = path.relative(source, destination);
    if (
        source === path.parse(source).root ||
        relative === "" ||
        (relative !== ".." &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative))
    )
        throw new Error("Migration output must be outside the source index");

    const descriptor: unknown = JSON.parse(
        await readFile(path.join(source, "index-schema.json"), "utf8"),
    );
    if (
        !descriptor ||
        typeof descriptor !== "object" ||
        !("indexKind" in descriptor) ||
        (descriptor.indexKind !== "documents" &&
            descriptor.indexKind !== "conversation-events" &&
            descriptor.indexKind !== "views")
    )
        throw new Error("Expected a memory-service index schema");
    const kind = descriptor.indexKind;
    if ((await classifyIndexSchema(source, kind, true)) !== "current")
        throw new Error(
            "The index requires a schema rebuild before embedding migration",
        );
    const fingerprint = await indexFingerprint(source, kind);
    const persisted: unknown = JSON.parse(
        await readFile(path.join(source, "corpus_data.json"), "utf8"),
    );
    settings ??= createDocMemorySettings();
    settings.conversationSettings.messageTextIndexSettings.splitText ??=
        splitDocPartTextForEmbedding;
    if (
        !settings.conversationSettings.messageTextIndexSettings
            .embeddingIndexSettings.embeddingModel
    )
        throw new Error("Configure an embedding model before migration");

    // Reserve the destination so failure cleanup can only remove our own copy.
    await mkdir(destination);
    let prepared = false;
    try {
        for (const entry of await readdir(source)) {
            await cp(path.join(source, entry), path.join(destination, entry), {
                recursive: true,
                force: false,
                errorOnExist: true,
                filter: async (file) => {
                    if ((await lstat(file)).isSymbolicLink())
                        throw new Error(
                            "Embedding migration does not copy symbolic links",
                        );
                    return true;
                },
            });
        }
        const memory = await DocMemory.readFromFile(
            destination,
            "corpus",
            settings,
            { rebuildEmbeddings: true },
        );
        if (!memory) throw new Error("Missing persisted document memory");
        await memory.writeToFile(
            destination,
            "corpus",
            isSegmentedJson(persisted),
        );
        const verified = new KnowProCorpusIndex(
            "embedding-migration",
            destination,
            () => settings,
        );
        await verified.initialize();
        if ((await indexFingerprint(source, kind)) !== fingerprint)
            throw new Error(
                "The source index changed during migration; stop all writers and retry",
            );
        prepared = true;
        return {
            outputDirectory: destination,
            indexKind: kind,
            messageCount: memory.messages.length,
            semanticRefCount: memory.semanticRefs.length,
        };
    } finally {
        if (!prepared) await rm(destination, { recursive: true, force: true });
    }
}
