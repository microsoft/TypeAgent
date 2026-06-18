// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    computeWorkingTreeSchemaHash,
    loadConstructionCacheLayer,
    reproduceSchemaSourceHash,
} from "../src/replay/constructionCacheResolver.js";

// The spec runs from `dist/test`; the committed fixture lives in the source
// `test/fixtures` dir next to `dist`. Resolve it relative to the package root.
const PKG_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
);
const FIXTURE = path.join(
    PKG_ROOT,
    "test",
    "fixtures",
    "playerConstructions.json",
);

/** The single namespace name (`player,<hash>`) stored in the fixture. */
function fixtureNamespace(): { name: string; hash: string } {
    const json = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
        constructionNamespaces: { name: string }[];
    };
    const name = json.constructionNamespaces[0].name;
    const hash = name.slice(name.indexOf(",") + 1);
    return { name, hash };
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
        const { hash } = fixtureNamespace();
        const layer = await loadConstructionCacheLayer({
            cacheFilePath: FIXTURE,
            schemaName: "player",
            currentHash: hash,
        });
        expect(layer.status).toBe("valid");
        expect(layer.cachedHash).toBe(hash);
        // "pause" resolves to the player pause action straight from the cache.
        expect(layer.match("pause")).toEqual({
            schemaName: "player",
            actionName: "pause",
        });
        // The schemaName is re-stamped onto the action regardless of the cache.
        const play = layer.match("play despacito");
        expect(play?.schemaName).toBe("player");
        expect(typeof play?.actionName).toBe("string");
    });

    test("stale: a mismatched hash falls back (no cache match)", async () => {
        const layer = await loadConstructionCacheLayer({
            cacheFilePath: FIXTURE,
            schemaName: "player",
            currentHash: "a-different-hash=",
        });
        expect(layer.status).toBe("stale");
        expect(layer.cachedHash).toBeDefined();
        expect(layer.match("pause")).toBeUndefined();
    });

    test("absent: no namespace for the schema", async () => {
        const { hash } = fixtureNamespace();
        const layer = await loadConstructionCacheLayer({
            cacheFilePath: FIXTURE,
            schemaName: "not-an-agent",
            currentHash: hash,
        });
        expect(layer.status).toBe("absent");
        expect(layer.match("pause")).toBeUndefined();
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
