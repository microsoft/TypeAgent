// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    loadRunConfigFile,
    resolveRunConfig,
    type RunConfigFile,
} from "../src/translationBench/runConfig.js";

const SAMPLE: RunConfigFile = {
    models: {
        "azure/gpt-5.4": { tpmLimit: 5_330_000, maxConcurrency: 200 },
        "azure/gpt-4.1": { tpmLimit: 4_850_000, maxConcurrency: 50 },
        "azure/gpt-4.1-mini": { tpmLimit: 15_890_000, maxConcurrency: 200 },
    },
    base: {
        synthesizer: {
            generatorModel: "azure/gpt-5.4",
            reviewerModel: "azure/gpt-5.4",
            genCases: 2,
            maxAttempts: 5,
        },
        eval: {
            models: ["azure/gpt-4.1", "azure/gpt-4.1-mini"],
            modelConcurrency: 3,
        },
    },
    batches: {
        eval_fast: {
            synthesizer: { caseCount: 100 },
            eval: { maxCases: 100, headroom: 0.9, caseOrder: "any" },
        },
        eval: {
            synthesizer: { caseCount: 1000 },
            eval: { maxCases: null, headroom: 0.85 },
        },
    },
};

describe("translationBench runConfig", () => {
    it("returns an empty object for a missing file", () => {
        expect(loadRunConfigFile("/nonexistent/does-not-exist.json")).toEqual(
            {},
        );
    });

    it("loads and parses a config file from disk", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "tb-runconfig-"));
        try {
            const filePath = path.join(dir, "config.json");
            writeFileSync(filePath, JSON.stringify(SAMPLE));
            expect(loadRunConfigFile(filePath)).toEqual(SAMPLE);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("throws with the file path on malformed json", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "tb-runconfig-"));
        try {
            const filePath = path.join(dir, "bad.json");
            writeFileSync(filePath, "{ not valid json ");
            expect(() => loadRunConfigFile(filePath)).toThrow(
                /failed to parse/,
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("defaults to the eval batch", () => {
        const resolved = resolveRunConfig(SAMPLE);
        expect(resolved.batch).toBe("eval");
        expect(resolved.caseCount).toBe(1000);
        expect(resolved.maxCases).toBeUndefined();
        expect(resolved.headroom).toBe(0.85);
    });

    it("deep-merges the selected batch over base", () => {
        const resolved = resolveRunConfig(SAMPLE, { batch: "eval_fast" });
        expect(resolved.caseCount).toBe(100);
        expect(resolved.maxCases).toBe(100);
        expect(resolved.headroom).toBe(0.9);
        expect(resolved.caseOrder).toBe("any");
        expect(resolved.generatorModel).toBe("azure/gpt-5.4");
        expect(resolved.evalModels).toEqual([
            "azure/gpt-4.1",
            "azure/gpt-4.1-mini",
        ]);
    });

    it("derives per-model concurrency from quota and headroom", () => {
        const resolved = resolveRunConfig(SAMPLE, {
            batch: "eval",
            tokPerMinPerSlot: 70_000,
        });
        expect(resolved.concurrencyByModel["azure/gpt-4.1"]).toBe(50);
        expect(resolved.concurrencyByModel["azure/gpt-4.1-mini"]).toBe(192);
    });

    it("prefers an explicit model concurrency over derivation", () => {
        const file: RunConfigFile = {
            models: {
                "azure/x": { tpmLimit: 1_000_000, concurrency: 7 },
            },
            base: { eval: { models: ["azure/x"] } },
            batches: { eval: {} },
        };
        const resolved = resolveRunConfig(file);
        expect(resolved.concurrencyByModel["azure/x"]).toBe(7);
    });

    it("exposes tpmLimits suitable for the rate limiter", () => {
        const resolved = resolveRunConfig(SAMPLE);
        expect(resolved.tpmLimits).toEqual({
            "azure/gpt-5.4": 5_330_000,
            "azure/gpt-4.1": 4_850_000,
            "azure/gpt-4.1-mini": 15_890_000,
        });
    });

    it("omits non-positive tpmLimits", () => {
        const file: RunConfigFile = {
            models: {
                "azure/on": { tpmLimit: 1_000_000 },
                "azure/off": { tpmLimit: 0 },
            },
        };
        const resolved = resolveRunConfig(file);
        expect(resolved.tpmLimits).toEqual({ "azure/on": 1_000_000 });
    });

    it("applies built-in defaults for an empty config", () => {
        const resolved = resolveRunConfig({});
        expect(resolved.generatorModel).toBe("azure/gpt-5.4");
        expect(resolved.reviewerModel).toBe("azure/gpt-5.4");
        expect(resolved.caseCount).toBe(1000);
        expect(resolved.genCases).toBe(2);
        expect(resolved.evalModels).toEqual([]);
        expect(resolved.tpmLimits).toEqual({});
        expect(resolved.modelConcurrency).toBe(1);
    });
});
