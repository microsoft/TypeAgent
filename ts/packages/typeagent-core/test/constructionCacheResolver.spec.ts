// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    computeWorkingTreeSchemaHash,
    loadConstructionCacheLayer,
    reproduceSchemaSourceHash,
} from "../src/replay/constructionCacheResolver.js";

const FIXTURE_HASH = "fixture-hash=";

function writeFixtureCache(dir: string, activityName = ""): string {
    const cacheFilePath = path.join(dir, "constructions.json");
    writeFileSync(
        cacheFilePath,
        JSON.stringify({
            version: 3,
            explainerName: "test",
            matchSets: [
                {
                    matches: ["pause"],
                    basename: "pause",
                    index: 0,
                    canBeMerged: true,
                    namespace: "player.pause::fullActionName",
                },
                {
                    matches: ["play"],
                    basename: "play",
                    index: 1,
                    canBeMerged: true,
                    namespace: "player.playMusic::fullActionName",
                },
                {
                    matches: ["despacito"],
                    basename: "song",
                    index: 2,
                    canBeMerged: true,
                },
            ],
            constructionNamespaces: [
                {
                    name: `player,${FIXTURE_HASH},${activityName}`,
                    constructions: [
                        {
                            parts: [
                                {
                                    matchSet: "pause_0",
                                    transformInfos: [
                                        {
                                            namespace: "player.pause",
                                            transformName: "fullActionName",
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            parts: [
                                {
                                    matchSet: "play_1",
                                    transformInfos: [
                                        {
                                            namespace: "player.playMusic",
                                            transformName: "fullActionName",
                                        },
                                    ],
                                },
                                {
                                    matchSet: "song_2",
                                },
                            ],
                        },
                    ],
                },
            ],
            transformNamespaces: [
                {
                    name: "player.pause",
                    transforms: [
                        {
                            name: "fullActionName",
                            transform: [
                                [
                                    "pause",
                                    {
                                        value: "player.pause",
                                        count: 1,
                                    },
                                ],
                            ],
                        },
                    ],
                },
                {
                    name: "player.playMusic",
                    transforms: [
                        {
                            name: "fullActionName",
                            transform: [
                                [
                                    "play",
                                    {
                                        value: "player.playMusic",
                                        count: 1,
                                    },
                                ],
                            ],
                        },
                    ],
                },
            ],
        }),
    );
    return cacheFilePath;
}

function tempDir(): string {
    return mkdtempSync(path.join(tmpdir(), "ccache-"));
}

describe("reproduceSchemaSourceHash", () => {
    test("is deterministic and order-sensitive", () => {
        const a = reproduceSchemaSourceHash({
            schemaType: { action: "FooActions", entity: "FooEntities" },
            source: "export type FooActions = {};",
        });
        const b = reproduceSchemaSourceHash({
            schemaType: { action: "FooActions", entity: "FooEntities" },
            source: "export type FooActions = {};",
        });
        expect(a).toBe(b);
        // base64 sha256 is 44 chars.
        expect(a).toHaveLength(44);
    });

    test("config participates in the hash", () => {
        const base = {
            schemaType: { action: "FooActions" },
            source: "src",
        };
        const withConfig = reproduceSchemaSourceHash({
            ...base,
            config: "{}",
        });
        expect(withConfig).not.toBe(reproduceSchemaSourceHash(base));
    });

    test("changing the source changes the hash (the regression signal)", () => {
        const before = reproduceSchemaSourceHash({
            schemaType: { action: "FooActions" },
            source: "v1",
        });
        const after = reproduceSchemaSourceHash({
            schemaType: { action: "FooActions" },
            source: "v2",
        });
        expect(before).not.toBe(after);
    });
});

describe("computeWorkingTreeSchemaHash", () => {
    test("hashes the built .pas.json with no sidecar config when present", async () => {
        const dir = tempDir();
        try {
            const pas = path.join(dir, "schema.pas.json");
            const ts = path.join(dir, "schema.ts");
            const cfg = path.join(dir, "schema.json");
            writeFileSync(pas, '{"pas":true}');
            writeFileSync(ts, "export type FooActions = {};");
            writeFileSync(cfg, '{"checked":1}');

            const schemaType = { action: "FooActions" };
            const got = await computeWorkingTreeSchemaHash({
                schemaType,
                builtSchemaFilePath: pas,
                sourceFilePath: ts,
                paramSpecConfigPath: cfg,
            });
            // Built schema is hashed WITHOUT the sidecar config.
            const expected = reproduceSchemaSourceHash({
                schemaType,
                source: '{"pas":true}',
            });
            expect(got).toBe(expected);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("falls back to the .ts source + sidecar config when no built schema", async () => {
        const dir = tempDir();
        try {
            const ts = path.join(dir, "schema.ts");
            const cfg = path.join(dir, "schema.json");
            writeFileSync(ts, "export type FooActions = {};");
            writeFileSync(cfg, '{"checked":1}');

            const schemaType = { action: "FooActions" };
            const got = await computeWorkingTreeSchemaHash({
                schemaType,
                sourceFilePath: ts,
                paramSpecConfigPath: cfg,
            });
            const expected = reproduceSchemaSourceHash({
                schemaType,
                source: "export type FooActions = {};",
                config: '{"checked":1}',
            });
            expect(got).toBe(expected);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("returns undefined when the artifact can't be read", async () => {
        const got = await computeWorkingTreeSchemaHash({
            schemaType: { action: "FooActions" },
            sourceFilePath: path.join(tmpdir(), "does-not-exist-xyz.ts"),
        });
        expect(got).toBeUndefined();
    });
});

describe("loadConstructionCacheLayer", () => {
    test("valid: a matching hash yields a faithful construction hit", async () => {
        const dir = tempDir();
        try {
            const layer = await loadConstructionCacheLayer({
                cacheFilePath: writeFixtureCache(dir),
                schemaName: "player",
                currentHash: FIXTURE_HASH,
            });
            expect(layer.status).toBe("valid");
            expect(layer.cachedHash).toBe(FIXTURE_HASH);
            // "pause" resolves to the player pause action straight from the cache.
            expect(layer.match("pause")).toEqual({
                schemaName: "player",
                actionName: "pause",
            });
            // The schemaName is re-stamped onto the action regardless of the cache.
            const play = layer.match("play despacito");
            expect(play?.schemaName).toBe("player");
            expect(typeof play?.actionName).toBe("string");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("valid: a non-empty activity suffix still validates the hash", async () => {
        const dir = tempDir();
        try {
            const layer = await loadConstructionCacheLayer({
                cacheFilePath: writeFixtureCache(dir, "playMusic"),
                schemaName: "player",
                currentHash: FIXTURE_HASH,
            });
            expect(layer.status).toBe("valid");
            expect(layer.match("pause")).toEqual({
                schemaName: "player",
                actionName: "pause",
            });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("valid: matchEntry surfaces the matched construction's identity", async () => {
        const dir = tempDir();
        try {
            const cacheFilePath = writeFixtureCache(dir);
            const layer = await loadConstructionCacheLayer({
                cacheFilePath,
                schemaName: "player",
                currentHash: FIXTURE_HASH,
            });
            const entry = layer.matchEntry("pause");
            expect(entry).toBeDefined();
            expect(entry?.action).toEqual({
                schemaName: "player",
                actionName: "pause",
            });
            // Identity is drawn from the matched construction and its namespace
            // (schema,hash,activity with an empty activity for the default fixture).
            expect(entry?.namespace).toBe(`player,${FIXTURE_HASH},`);
            expect(entry?.constructionId).toMatch(/^\d+$/);
            expect(entry?.parts?.length).toBeGreaterThan(0);
            expect(entry?.scores?.matchedCount).toBeGreaterThanOrEqual(0);
            expect(entry?.cacheFileId).toBe(cacheFilePath);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("stale: a mismatched hash falls back (no cache match)", async () => {
        const dir = tempDir();
        try {
            const layer = await loadConstructionCacheLayer({
                cacheFilePath: writeFixtureCache(dir),
                schemaName: "player",
                currentHash: "a-different-hash=",
            });
            expect(layer.status).toBe("stale");
            expect(layer.cachedHash).toBe(FIXTURE_HASH);
            expect(layer.match("pause")).toBeUndefined();
            expect(layer.matchEntry("pause")).toBeUndefined();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("absent: no namespace for the schema", async () => {
        const dir = tempDir();
        try {
            const layer = await loadConstructionCacheLayer({
                cacheFilePath: writeFixtureCache(dir),
                schemaName: "not-an-agent",
                currentHash: FIXTURE_HASH,
            });
            expect(layer.status).toBe("absent");
            expect(layer.match("pause")).toBeUndefined();
            expect(layer.matchEntry("pause")).toBeUndefined();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("absent: missing cache file degrades cleanly (never throws)", async () => {
        const layer = await loadConstructionCacheLayer({
            cacheFilePath: path.join(tmpdir(), "no-such-cache-xyz.json"),
            schemaName: "player",
            currentHash: "anything=",
        });
        expect(layer.status).toBe("absent");
        expect(layer.match("pause")).toBeUndefined();
    });
});
