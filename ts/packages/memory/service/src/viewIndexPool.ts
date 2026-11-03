// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { open, readFile } from "node:fs/promises";
import path from "node:path";
import {
    isSegmentedJson,
    timeSearchStage,
    verifySegmentedJson,
} from "@typeagent/knowpro";
import { ImmutableReadCache } from "./immutableReadCache.js";
import { classifyIndexSchema, indexFingerprint } from "./indexSchema.js";
import type { CorpusIndex, CorpusIndexFactory } from "./types.js";

export class ViewIndexPool {
    private readonly cache = new ImmutableReadCache<CorpusIndex>(
        "view.index",
        64,
        128 * 1024 * 1024,
    );

    constructor(private readonly factory: CorpusIndexFactory) {}

    async acquire(
        corpusId: string,
        directory: string,
        revisionId: string,
    ): Promise<CorpusIndex> {
        const index = await this.read(
            corpusId,
            directory,
            revisionId,
            "foreground",
        );
        if (!index) throw new Error("Requested view reader was not loaded");
        return index;
    }

    async warm(
        corpusId: string,
        directory: string,
        revisionId: string,
        priority: boolean,
    ): Promise<boolean> {
        return !!(await this.read(
            corpusId,
            directory,
            revisionId,
            priority ? "priority" : "background",
        ));
    }

    private async read(
        corpusId: string,
        directory: string,
        revisionId: string,
        mode: "foreground" | "priority" | "background",
    ): Promise<CorpusIndex | undefined> {
        const assertCurrent = this.cache.guard(corpusId);
        return timeSearchStage(
            "view.index.acquire",
            async () => {
                let key: string | undefined;
                try {
                    let fingerprint = await indexFingerprint(
                        directory,
                        "views",
                    );
                    key = JSON.stringify([
                        corpusId,
                        directory,
                        revisionId,
                        fingerprint,
                    ]);
                    if (!this.cache.has(key)) {
                        // Opening freshly written files settles delayed Windows metadata
                        // before the immutable identity is captured.
                        await this.prepareFileIdentity(directory);
                        fingerprint = await indexFingerprint(
                            directory,
                            "views",
                        );
                        key = JSON.stringify([
                            corpusId,
                            directory,
                            revisionId,
                            fingerprint,
                        ]);
                    }
                    const content: unknown = JSON.parse(
                        await readFile(
                            path.join(directory, "corpus_data.json"),
                            "utf8",
                        ),
                    );
                    const segmentBytes = isSegmentedJson(content)
                        ? await verifySegmentedJson(
                              path.join(directory, "corpus_data.json"),
                              content,
                          )
                        : 0;
                    const stamps: unknown = JSON.parse(fingerprint);
                    const fileBytes = Array.isArray(stamps)
                        ? stamps.reduce(
                              (total: number, stamp: unknown) =>
                                  total +
                                  (Array.isArray(stamp) &&
                                  typeof stamp[2] === "number"
                                      ? stamp[2]
                                      : 0),
                              0,
                          )
                        : 0;
                    const bytes = Math.max(
                        1024,
                        4 * (fileBytes + segmentBytes),
                    );
                    if (
                        mode !== "foreground" &&
                        !this.cache.has(key) &&
                        (!this.cache.canRetain(bytes) ||
                            (mode === "background" &&
                                !this.cache.hasSpace(bytes)))
                    )
                        return undefined;
                    assertCurrent();
                    return await this.cache.get(key, corpusId, async () => {
                        if (
                            (await classifyIndexSchema(
                                directory,
                                "views",
                                true,
                            )) !== "current" ||
                            (await readFile(
                                path.join(directory, "ready"),
                                "utf8",
                            )) !== revisionId
                        )
                            throw new Error(
                                "Published view index is missing or does not match the exact revision; retry indexing",
                            );
                        const index = this.factory(corpusId, directory);
                        await timeSearchStage("view.index.initialize", () =>
                            index.initialize(),
                        );
                        if (
                            fingerprint !==
                            (await indexFingerprint(directory, "views"))
                        )
                            throw new Error(
                                "Published view index changed during reader initialization",
                            );
                        return {
                            value: index,
                            bytes,
                        };
                    });
                } catch (error) {
                    if (key) this.cache.evict(key);
                    throw error;
                }
            },
            { corpusId, revisionId },
        );
    }

    private async prepareFileIdentity(directory: string): Promise<void> {
        await Promise.all(
            [
                "index-schema.json",
                "corpus_data.json",
                "eligibility.json",
                "corpus_embeddings.bin",
                "ready",
            ].map(async (name) => {
                try {
                    const handle = await open(path.join(directory, name), "r");
                    await handle.close();
                } catch (error) {
                    if (
                        !(
                            typeof error === "object" &&
                            error !== null &&
                            "code" in error &&
                            error.code === "ENOENT"
                        )
                    )
                        throw error;
                }
            }),
        );
    }

    invalidate(corpusId?: string): void {
        this.cache.invalidate(corpusId);
    }

    close(): void {
        this.cache.close();
    }
}
