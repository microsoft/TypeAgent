// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Result, success, error } from "typechat";
import {
    AssistantSelection,
    selectFromPartitions,
} from "../src/translation/unknownSwitcher.js";

function makeTranslator(
    result: Result<AssistantSelection>,
    delayMs = 0,
): { translate: (request: string) => Promise<Result<AssistantSelection>> } {
    return {
        translate: (_request: string) =>
            new Promise((resolve) =>
                setTimeout(() => resolve(result), delayMs),
            ),
    };
}

const unknownResult = success<AssistantSelection>({
    assistant: "unknown",
    action: "unknown",
});

const calendarResult = success<AssistantSelection>({
    assistant: "calendar",
    action: "addEvent",
});

const playerResult = success<AssistantSelection>({
    assistant: "player",
    action: "play",
});

describe("selectFromPartitions", () => {
    test("single partition returning a match", async () => {
        const partitions = [
            { names: ["calendar"], translator: makeTranslator(calendarResult) },
        ];
        const result = await selectFromPartitions(partitions, "add an event");
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.assistant).toBe("calendar");
        }
    });

    test("single partition returning unknown yields unknown fallback", async () => {
        const partitions = [
            { names: ["calendar"], translator: makeTranslator(unknownResult) },
        ];
        const result = await selectFromPartitions(partitions, "do something");
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.assistant).toBe("unknown");
            expect(result.data.action).toBe("unknown");
        }
    });

    test("all partitions returning unknown yields unknown fallback", async () => {
        const partitions = [
            { names: ["calendar"], translator: makeTranslator(unknownResult) },
            { names: ["player"], translator: makeTranslator(unknownResult) },
            { names: ["email"], translator: makeTranslator(unknownResult) },
        ];
        const result = await selectFromPartitions(
            partitions,
            "do something unrecognized",
        );
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.assistant).toBe("unknown");
        }
    });

    test("first non-unknown result is returned in partition order", async () => {
        const partitions = [
            { names: ["calendar"], translator: makeTranslator(unknownResult) },
            { names: ["player"], translator: makeTranslator(playerResult) },
            { names: ["email"], translator: makeTranslator(calendarResult) },
        ];
        const result = await selectFromPartitions(partitions, "play music");
        expect(result.success).toBe(true);
        if (result.success) {
            // "player" partition (index 1) is first non-unknown in order
            expect(result.data.assistant).toBe("player");
        }
    });

    test("earlier partition match wins even when later partition resolves first", async () => {
        const partitions = [
            // slow but should win (index 0, first in order)
            {
                names: ["calendar"],
                translator: makeTranslator(calendarResult, 30),
            },
            // fast but should lose (index 1, later in order)
            {
                names: ["player"],
                translator: makeTranslator(playerResult, 0),
            },
        ];
        const result = await selectFromPartitions(
            partitions,
            "add an event or play",
        );
        expect(result.success).toBe(true);
        if (result.success) {
            // calendar partition (index 0) wins even though player resolved first
            expect(result.data.assistant).toBe("calendar");
        }
    });

    test("all partitions run in parallel", async () => {
        const startTimes: number[] = [];
        const makeTimedTranslator = (
            result: Result<AssistantSelection>,
            delayMs: number,
        ) => ({
            translate: (_request: string) => {
                startTimes.push(Date.now());
                return new Promise<Result<AssistantSelection>>((resolve) =>
                    setTimeout(() => resolve(result), delayMs),
                );
            },
        });

        const partitions = [
            {
                names: ["a"],
                translator: makeTimedTranslator(unknownResult, 20),
            },
            {
                names: ["b"],
                translator: makeTimedTranslator(unknownResult, 20),
            },
            {
                names: ["c"],
                translator: makeTimedTranslator(unknownResult, 20),
            },
        ];

        const before = Date.now();
        await selectFromPartitions(partitions, "test");
        const elapsed = Date.now() - before;

        // All three started nearly simultaneously (within 10ms of each other)
        expect(startTimes).toHaveLength(3);
        const spread = Math.max(...startTimes) - Math.min(...startTimes);
        expect(spread).toBeLessThan(10);

        // Parallel: total time should be close to one delay (not 3×)
        expect(elapsed).toBeLessThan(80);
    });

    test("error from a partition is propagated in order", async () => {
        const failResult = error("LLM call failed");
        const partitions = [
            { names: ["calendar"], translator: makeTranslator(unknownResult) },
            { names: ["player"], translator: makeTranslator(failResult) },
            { names: ["email"], translator: makeTranslator(calendarResult) },
        ];
        const result = await selectFromPartitions(
            partitions,
            "something failing",
        );
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.message).toBe("LLM call failed");
        }
    });

    test("empty partitions list returns unknown", async () => {
        const result = await selectFromPartitions([], "any request");
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.assistant).toBe("unknown");
        }
    });
});
