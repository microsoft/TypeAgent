// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createMaintenanceModelScheduler,
    resolveMaintenanceConcurrency,
    maintenanceExtractionModel,
    withMaintenanceExtraction,
    createMaintenanceBuildScheduler,
} from "../src/maintenanceConcurrency.js";
import type { ChatModel } from "@typeagent/aiclient";
import { createDocMemorySettings } from "@typeagent/conversation-memory";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createKnowProCorpusIndex } from "../src/knowProCorpusIndex.js";

test("settings-factory extraction shares admission while preserving the extractor, validator and batch settings", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "memory-factory-pool-"));
    let active = 0;
    let peak = 0;
    const settings = createDocMemorySettings(64, undefined, {
        completionSettings: {},
        complete: async () => {
            peak = Math.max(peak, ++active);
            await new Promise((resolve) => setImmediate(resolve));
            active--;
            return {
                success: true,
                data: JSON.stringify({
                    entities: [],
                    actions: [],
                    inverseActions: [],
                    topics: [],
                }),
            };
        },
    });
    const extraction = settings.conversationSettings.semanticRefIndexSettings;
    const extractor = extraction.knowledgeExtractor;
    const validator = () => true;
    extraction.knowledgeValidator = validator;
    extraction.batchSize = 8;
    const index = createKnowProCorpusIndex("corpus", root, () => settings);
    try {
        await index.initialize();
        await index.initialize();
        expect(extraction.knowledgeExtractor).toBe(extractor);
        expect(extraction.knowledgeValidator).toBe(validator);
        expect(extraction.batchSize).toBe(8);
        if (!extractor) throw new Error("Missing factory extractor");
        const schedule = createMaintenanceModelScheduler(1);
        const results = await withMaintenanceExtraction(schedule, () =>
            Promise.all([
                extractor.extractWithRetry("First source", 0),
                extractor.extractWithRetry("Second source", 0),
            ]),
        );
        expect(results.every((result) => result.success)).toBe(true);
        expect(peak).toBe(1);
        peak = 0;
        await Promise.all([
            extractor.extractWithRetry("Foreground first", 0),
            extractor.extractWithRetry("Foreground second", 0),
        ]);
        expect(peak).toBe(2);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("one maintenance model pool bounds independent callers and rejects queued cancellation", async () => {
    const schedule = createMaintenanceModelScheduler(2);
    let active = 0;
    let maximum = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const entered: string[] = [];
    const work = (name: string) => async () => {
        entered.push(name);
        maximum = Math.max(maximum, ++active);
        await gate;
        active--;
        return name;
    };
    const first = schedule(work("wiki"));
    const second = schedule(work("decision"));
    const controller = new AbortController();
    const cancelled = schedule(work("cancelled"), controller.signal);
    const rejected = expect(cancelled).rejects.toThrow("cancelled request");
    const next = schedule(work("topic"));
    const synopsis = schedule(work("synopsis"));
    try {
        await new Promise((resolve) => setImmediate(resolve));
        expect(entered).toEqual(["wiki", "decision"]);
        expect(maximum).toBe(2);
        controller.abort(new Error("cancelled request"));
        await rejected;
        expect(entered).toEqual(["wiki", "decision"]);
    } finally {
        release();
    }
    expect(await Promise.all([first, second, next, synopsis])).toEqual([
        "wiki",
        "decision",
        "topic",
        "synopsis",
    ]);
    await rejected;
    expect(entered).not.toContain("cancelled");
    expect(maximum).toBe(2);
});

test("aborting an active model request retains its permit until the operation settles", async () => {
    const schedule = createMaintenanceModelScheduler(1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const controller = new AbortController();
    const entered: string[] = [];
    const first = schedule(async () => {
        entered.push("active");
        await gate;
    }, controller.signal);
    const next = schedule(async () => {
        entered.push("next");
    });
    try {
        await new Promise((resolve) => setImmediate(resolve));
        controller.abort(new Error("Active request cancelled"));
        await new Promise((resolve) => setImmediate(resolve));
        expect(entered).toEqual(["active"]);
    } finally {
        release();
        await Promise.all([first, next]);
    }
    expect(entered).toEqual(["active", "next"]);
});

test("maintenance concurrency retains serial build defaults and validates both bounds", () => {
    expect(resolveMaintenanceConcurrency()).toEqual({
        builds: 1,
        modelRequests: 24,
    });
    for (const options of [
        { builds: 0 },
        { builds: 9 },
        { builds: 1.5 },
        { modelRequests: 0 },
        { modelRequests: 25 },
        { modelRequests: NaN },
    ])
        expect(() => resolveMaintenanceConcurrency(options)).toThrow(
            "Maintenance",
        );
});

test("view extraction shares the maintenance pool without limiting foreground calls", async () => {
    const schedule = createMaintenanceModelScheduler(1);
    let active = 0;
    let peak = 0;
    const model: ChatModel = {
        completionSettings: {},
        complete: async () => {
            peak = Math.max(peak, ++active);
            await new Promise((resolve) => setImmediate(resolve));
            active--;
            return { success: true, data: "done" };
        },
    };
    const extraction = maintenanceExtractionModel(model);
    await Promise.all([
        schedule(() => model.complete("native")),
        withMaintenanceExtraction(schedule, () =>
            Promise.all([
                extraction.complete("first view"),
                extraction.complete("second view"),
            ]),
        ),
    ]);
    expect(peak).toBe(1);
    peak = 0;
    await Promise.all([
        extraction.complete("foreground"),
        extraction.complete("foreground"),
    ]);
    expect(peak).toBe(2);
});

test("cancelled extraction releases admission without invoking the provider", async () => {
    const schedule = createMaintenanceModelScheduler(1);
    let calls = 0;
    const model = maintenanceExtractionModel({
        completionSettings: {},
        complete: async () => {
            calls++;
            return { success: true, data: "done" };
        },
    });
    const controller = new AbortController();
    controller.abort(new Error("cancelled extraction"));
    await expect(
        withMaintenanceExtraction(schedule, () =>
            model.complete(
                "view",
                undefined,
                undefined,
                undefined,
                controller.signal,
            ),
        ),
    ).rejects.toThrow("cancelled extraction");
    expect(calls).toBe(0);
    await expect(
        withMaintenanceExtraction(schedule, () => model.complete("view")),
    ).resolves.toEqual({ success: true, data: "done" });
});

test("reserved short capacity admits Wiki work before the fourth native build", async () => {
    const schedule = createMaintenanceBuildScheduler(4, true);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const entered: string[] = [];
    const native = Array.from({ length: 4 }, (_, index) =>
        schedule(async () => {
            entered.push(`native-${index}`);
            await gate;
        }, true),
    );
    try {
        await new Promise((resolve) => setImmediate(resolve));
        expect(entered).toEqual(["native-0", "native-1", "native-2"]);
        await schedule(async () => {
            entered.push("wiki");
        }, false);
        expect(entered).toEqual(["native-0", "native-1", "native-2", "wiki"]);
    } finally {
        release();
    }
    await Promise.all(native);
    expect(entered[entered.length - 1]).toBe("native-3");
});
