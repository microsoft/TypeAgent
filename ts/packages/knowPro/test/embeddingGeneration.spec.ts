// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { EmbeddingIdentity } from "@typeagent/aiclient";
import {
    EmbeddingGenerationStore,
    GenerationBuild,
} from "../src/embeddingGeneration.js";

const identity: EmbeddingIdentity = {
    schemaVersion: 1,
    provider: "synthetic",
    model: "fixture",
    revision: "1",
    dimensions: 2,
    task: "document",
    prompt: "",
    pooling: "mean",
    normalization: "l2",
    preprocessing: "fixture",
    artifactHash: "a".repeat(64),
};

interface RenameHooks {
    renameFile(source: string, destination: string): Promise<void>;
    renameAtomically(
        source: string,
        destination: string,
        windows?: boolean,
    ): Promise<void>;
}

describe("opt-in embedding generations", () => {
    const root = path.resolve(`generation-test-${randomUUID()}`);
    let store: EmbeddingGenerationStore;
    const input = (generationId: string, revision = "1"): GenerationBuild => ({
        generationId,
        lanes: { pixel: identity },
        artifacts: { "vectors.json": JSON.stringify([[1, 0]]) },
        records: [
            { sourceId: "forgotten", revision },
            { sourceId: "corrected", revision },
        ],
    });
    beforeEach(async () => {
        await fs.rm(root, { recursive: true, force: true });
        store = new EmbeddingGenerationStore(root);
    });
    afterEach(async () => fs.rm(root, { recursive: true, force: true }));

    test("fresh-process reload, correction/forget ledger survives rollback", async () => {
        await store.build(input("old"));
        await store.activate("old");
        await store.build(input("new", "2"));
        await store.activate("new");
        await Promise.all([
            store.forget("forgotten"),
            store.correct("corrected", "2"),
        ]);
        expect((await store.load()).records.map((r) => r.sourceId)).toEqual([
            "corrected",
        ]);
        await store.rollback("old");
        const moduleUrl = new URL("../embeddingGeneration.js", import.meta.url)
            .href;
        const script = `const {EmbeddingGenerationStore}=await import(${JSON.stringify(moduleUrl)}); const loaded=await new EmbeddingGenerationStore(${JSON.stringify(root)}).load(); console.log(JSON.stringify({id:loaded.manifest.generationId,records:loaded.records}));`;
        const output = execFileSync(
            process.execPath,
            ["--input-type=module", "-e", script],
            { encoding: "utf8" },
        );
        expect(JSON.parse(output)).toEqual({ id: "old", records: [] });
        await expect(store.correct("forgotten", "3")).rejects.toThrow(
            "cannot be restored",
        );
        await store.deleteGeneration("new");
        await expect(store.load("new")).rejects.toThrow(
            "Unknown or incomplete",
        );
    });

    test("same dimensions wrong identity and corrupt/missing artifacts fail closed", async () => {
        await store.build(input("good"));
        await store.activate("good");
        await expect(
            store.load(undefined, {
                pixel: { ...identity, revision: "other" },
            }),
        ).rejects.toThrow("identity mismatch");
        await store.build(input("bad"));
        const artifact = path.join(root, "generations", "bad", "vectors.json");
        await fs.writeFile(artifact, "corrupt");
        await expect(store.activate("bad")).rejects.toThrow(
            "Corrupt generation artifact",
        );
        expect((await store.load()).manifest.generationId).toBe("good");
        await fs.unlink(artifact);
        await expect(store.activate("bad")).rejects.toThrow();
        expect((await store.load()).manifest.generationId).toBe("good");
        await expect(store.deleteGeneration("good")).rejects.toThrow("active");
    });

    test("failed writes and interrupted writer cannot replace active", async () => {
        await store.build(input("good"));
        await store.activate("good");
        await expect(
            store.build({
                ...input("fail"),
                artifacts: { "invalid/name": "x" },
            }),
        ).rejects.toThrow("Invalid");
        expect((await store.load()).manifest.generationId).toBe("good");
        const writer = store as unknown as {
            writeDurable(
                file: string,
                data: string | Uint8Array,
            ): Promise<void>;
        };
        const write = writer.writeDurable.bind(writer);
        writer.writeDurable = async (file, data) => {
            if (path.basename(file).startsWith("state-"))
                throw new Error("Injected state write failure");
            return write(file, data);
        };
        try {
            await expect(store.build(input("write-failure"))).rejects.toThrow(
                "Injected state write failure",
            );
        } finally {
            writer.writeDurable = write;
        }
        expect((await store.load()).manifest.generationId).toBe("good");
        await expect(store.load("write-failure")).rejects.toThrow(
            "Unknown or incomplete",
        );
        await fs.writeFile(path.join(root, "writer.lock"), "interrupted");
        await expect(store.activate("good")).rejects.toThrow("locked");
        expect((await store.load()).manifest.generationId).toBe("good");
    });

    test("state and manifest integrity failures are explicit", async () => {
        await store.build(input("good"));
        await store.activate("good");
        await fs.appendFile(
            path.join(root, "generations", "good", "manifest.json"),
            " ",
        );
        await expect(store.load()).rejects.toThrow(
            "Corrupt generation manifest",
        );
        await fs.unlink(path.join(root, "state.json"));
        await expect(store.load()).rejects.toThrow(
            "Missing embedding generation state",
        );
    });
    test("visibility ledger corruption is rejected rather than resurrecting records", async () => {
        await store.build(input("good"));
        await store.activate("good");
        await store.forget("forgotten");
        const stateFile = path.join(root, "state.json");
        const state = JSON.parse(await fs.readFile(stateFile, "utf8")) as {
            visibility: Record<string, unknown>;
        };
        delete state.visibility.forgotten;
        await fs.writeFile(stateFile, JSON.stringify(state));
        await expect(new EmbeddingGenerationStore(root).load()).rejects.toThrow(
            "Corrupt embedding generation state",
        );
    });

    test("retries transient Windows directory and active-state rename failures", async () => {
        await store.build(input("good"));
        await store.activate("good");
        const hooks = store as unknown as RenameHooks;
        const rename = hooks.renameFile.bind(hooks);
        const atomic = hooks.renameAtomically.bind(hooks);
        hooks.renameAtomically = (source, destination) =>
            atomic(source, destination, true);
        let directoryFailures = 2;
        let stateFailures = 0;
        hooks.renameFile = async (source, destination) => {
            if (
                path.basename(destination) === "next" &&
                directoryFailures-- > 0
            ) {
                throw Object.assign(
                    new Error("Injected scanner directory handle"),
                    { code: "EPERM" },
                );
            }
            if (
                path.basename(destination) === "state.json" &&
                stateFailures-- > 0
            ) {
                expect((await store.load()).manifest.generationId).toBe("good");
                throw Object.assign(
                    new Error("Injected scanner state handle"),
                    { code: "EBUSY" },
                );
            }
            return rename(source, destination);
        };
        await store.build(input("next"));
        expect(directoryFailures).toBe(-1);
        expect((await store.load()).manifest.generationId).toBe("good");
        stateFailures = 2;
        await store.activate("next");
        expect(stateFailures).toBe(-1);
        expect((await store.load()).manifest.generationId).toBe("next");
    });

    test("rename retry exhaustion preserves active state; unrelated errors are not retried", async () => {
        await store.build(input("good"));
        await store.activate("good");
        await store.build(input("next"));
        const hooks = store as unknown as RenameHooks;
        const atomic = hooks.renameAtomically.bind(hooks);
        hooks.renameAtomically = (source, destination) =>
            atomic(source, destination, true);
        let attempts = 0;
        hooks.renameFile = async () => {
            attempts++;
            throw Object.assign(
                new Error("Injected persistent sharing violation"),
                { code: "EACCES" },
            );
        };
        await expect(store.activate("next")).rejects.toThrow(
            "attempt 8/8; retries exhausted",
        );
        expect(attempts).toBe(8);
        expect((await store.load()).manifest.generationId).toBe("good");
        attempts = 0;
        hooks.renameFile = async () => {
            attempts++;
            throw Object.assign(new Error("Injected disk error"), {
                code: "EIO",
            });
        };
        await expect(store.activate("next")).rejects.toThrow(
            "Injected disk error",
        );
        expect(attempts).toBe(1);
        expect((await store.load()).manifest.generationId).toBe("good");
    });
});
