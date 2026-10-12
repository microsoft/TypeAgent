// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readViewSourceText } from "./memoryHubViewBuild";
import { invokeMemory } from "./viewClient";

jest.mock("./viewClient", () => ({ invokeMemory: jest.fn() }));
const invoke = invokeMemory as jest.Mock;
const source = { sourceId: "s", revisionId: "r" };

beforeEach(() => invoke.mockReset());

test("timeline inspection pages exact evidence through the 100000-character API limit", async () => {
    invoke
        .mockResolvedValueOnce({
            revisionId: "r",
            content: "a".repeat(100000),
            totalChars: 120000,
            truncated: true,
            nextOffset: 100000,
        })
        .mockResolvedValueOnce({
            revisionId: "r",
            content: "b".repeat(20000),
            totalChars: 120000,
            truncated: false,
        });
    expect(await readViewSourceText("c", source)).toBe(
        "a".repeat(100000) + "b".repeat(20000),
    );
    expect(invoke.mock.calls).toEqual([
        [
            "memoryGetSourceContent",
            { corpusId: "c", ...source, offset: 0, maxChars: 100000 },
        ],
        [
            "memoryGetSourceContent",
            { corpusId: "c", ...source, offset: 100000, maxChars: 20000 },
        ],
    ]);
});

test.each([
    [
        { revisionId: "other", content: "", truncated: false },
        "revision changed",
    ],
    [
        { revisionId: "r", content: "", totalChars: 120001, truncated: true },
        "text bound",
    ],
    [
        { revisionId: "r", content: "text", truncated: true, nextOffset: 0 },
        "paging did not advance",
    ],
])(
    "invalid evidence does not produce a success-shaped record selection",
    async (page, message) => {
        invoke.mockResolvedValue(page);
        await expect(readViewSourceText("c", source)).rejects.toThrow(message);
    },
);
