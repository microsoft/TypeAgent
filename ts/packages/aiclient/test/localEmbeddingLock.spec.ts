// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runWithLocalEmbeddingModelLock } from "../src/localEmbeddingLock.js";

describe("runWithLocalEmbeddingModelLock", () => {
    test("serializes model initialization for the same cache and model", async () => {
        const cacheDir = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-embedding-lock-"),
        );
        let markFirstStarted: (() => void) | undefined;
        const firstStarted = new Promise<void>((resolve) => {
            markFirstStarted = resolve;
        });
        let releaseFirst: (() => void) | undefined;
        const firstCanFinish = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        let secondStarted = false;

        try {
            const first = runWithLocalEmbeddingModelLock(
                cacheDir,
                "Xenova/all-MiniLM-L6-v2",
                async () => {
                    markFirstStarted?.();
                    await firstCanFinish;
                },
            );
            await firstStarted;
            const second = runWithLocalEmbeddingModelLock(
                cacheDir,
                "Xenova/all-MiniLM-L6-v2",
                async () => {
                    secondStarted = true;
                },
            );

            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(secondStarted).toBe(false);

            releaseFirst?.();
            await Promise.all([first, second]);
            expect(secondStarted).toBe(true);
        } finally {
            await rm(cacheDir, { recursive: true, force: true });
        }
    });

    test("reclaims a lock abandoned by a terminated process", async () => {
        const cacheDir = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-embedding-lock-"),
        );
        const modelName = "Xenova/all-MiniLM-L6-v2";
        const lockKey = createHash("sha256").update(modelName).digest("hex");
        const lockDir = path.join(cacheDir, ".typeagent-locks");
        const lockPath = path.join(lockDir, `${lockKey}.lock`);

        try {
            await mkdir(lockDir, { recursive: true });
            await writeFile(lockPath, JSON.stringify({ pid: 2_147_483_647 }));

            let started = false;
            await runWithLocalEmbeddingModelLock(
                cacheDir,
                modelName,
                async () => {
                    started = true;
                },
            );

            expect(started).toBe(true);
        } finally {
            await rm(cacheDir, { recursive: true, force: true });
        }
    });
});
