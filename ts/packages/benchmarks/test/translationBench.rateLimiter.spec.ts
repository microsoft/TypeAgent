// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    createRateLimiter,
    type RateLimiter,
} from "../src/core/rateLimiter.js";

describe("translationBench rateLimiter", () => {
    let tempDir: string;
    let dbPath: string;
    const limiters: RateLimiter[] = [];

    beforeEach(() => {
        tempDir = mkdtempSync(path.join(tmpdir(), "tb-ratelimiter-"));
        dbPath = path.join(tempDir, "tpm.sqlite");
    });

    afterEach(() => {
        while (limiters.length > 0) {
            limiters.pop()?.close();
        }
        rmSync(tempDir, { recursive: true, force: true });
    });

    function make(
        limits: Record<string, number>,
        estTokensPerCall = 10_400,
    ): RateLimiter {
        const limiter = createRateLimiter(limits, {
            dbPath,
            estTokensPerCall,
            maxWaitMs: 300,
        });
        limiters.push(limiter);
        return limiter;
    }

    it("passes through models without a positive quota", async () => {
        const limiter = make({ "azure/free": 0, "azure/missing": NaN });
        expect(limiter.disabledFor("azure/free")).toBe(true);
        expect(limiter.disabledFor("azure/unknown")).toBe(true);

        const result = await limiter.run("azure/free", 1000, async () => ({
            result: "ok",
            actualTokens: 1000,
        }));
        expect(result).toBe("ok");
    });

    it("admits calls that fit within the per-minute budget", async () => {
        const limiter = make({ "azure/m": 600_000 });
        expect(limiter.disabledFor("azure/m")).toBe(false);

        let calls = 0;
        for (let i = 0; i < 10; i++) {
            await limiter.run("azure/m", 1000, async () => {
                calls++;
                return { result: calls, actualTokens: 1000 };
            });
        }
        expect(calls).toBe(10);
    });

    it("throttles a call that would exceed the budget", async () => {
        const limiter = make({ "azure/m": 120_000 });

        await limiter.run("azure/m", 100_000, async () => ({
            result: "big",
            actualTokens: 100_000,
        }));

        await expect(
            limiter.run("azure/m", 30_000, async () => ({
                result: "blocked",
                actualTokens: 30_000,
            })),
        ).rejects.toThrow(/max wait/);
    });

    it("settles claims to the measured actual token count", async () => {
        const limiter = make({ "azure/m": 120_000 });

        await limiter.run("azure/m", 100_000, async () => ({
            result: "over-estimated",
            actualTokens: 10_000,
        }));

        let admittedPromptly = false;
        await limiter.run("azure/m", 100_000, async () => {
            admittedPromptly = true;
            return { result: "second", actualTokens: 10_000 };
        });
        expect(admittedPromptly).toBe(true);
    });

    it("shares one budget across independent limiter instances (same db)", async () => {
        const a = make({ "azure/m": 120_000 });
        const b = make({ "azure/m": 120_000 });

        await a.run("azure/m", 100_000, async () => ({
            result: "a",
            actualTokens: 100_000,
        }));

        await expect(
            b.run("azure/m", 30_000, async () => ({
                result: "b",
                actualTokens: 30_000,
            })),
        ).rejects.toThrow(/max wait/);
    });

    it("falls back to the default estimate when none is given", async () => {
        const limiter = make({ "azure/m": 60_000 }, 50_000);

        let calls = 0;
        for (let i = 0; i < 3; i++) {
            await limiter.run("azure/m", undefined, async () => {
                calls++;
                return { result: calls, actualTokens: 1_000 };
            });
        }
        expect(calls).toBe(3);
    });

    it("throws when no positive estimate is available for a limited model", async () => {
        const limiter = createRateLimiter(
            { "azure/m": 120_000 },
            { dbPath, estTokensPerCall: 0 },
        );
        limiters.push(limiter);
        await expect(
            limiter.run("azure/m", undefined, async () => ({
                result: "x",
                actualTokens: 1,
            })),
        ).rejects.toThrow(/token estimate/);
    });
});
