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
