// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    applyIndexedBlockPolicy,
    parseIndexedLocator,
    selectIndexedFragments,
    type IndexedBlock,
    type IndexedFragmentPolicy,
} from "../src/indexedFragments.js";
import type { IndexedFragmentRequest } from "../src/types.js";

const block = (sourceId: string, text: string, score = 1): IndexedBlock => ({
    sourceId,
    revisionId: "current",
    blockOrdinal: 0,
    messageOrdinal: 0,
    text,
    score,
});
const first = block("first", "Budget background. ".repeat(120), 10);
const second = block("second", "Budget price is 200000.", 2);
const request: IndexedFragmentRequest = {
    sourceIds: ["first", "second"],
    query: "What is the budget price?",
    terms: ["budget", "price"],
    maxFragments: 1,
    includeDiagnostics: true,
};

test("absent policy preserves the pool by identity without enumerating other blocks", () => {
    const pool = [first];
    expect(
        applyIndexedBlockPolicy(undefined, request, pool, () => {
            throw new Error("Must not enumerate without an intervention");
        }),
    ).toBe(pool);
});

test("an observational policy preserves baseline selection and diagnostics", () => {
    const pool = [{ ...first, postingScore: 4, languageScore: 6 }, second];
    const observed: IndexedFragmentPolicy = {
        selectBlocks: ({ nativeBlocks }) => [...nativeBlocks],
    };
    const selected = applyIndexedBlockPolicy(observed, request, pool, () => [
        first,
        second,
    ]);
    expect(selected).toEqual(pool);
    expect(selectIndexedFragments(selected, request, observed)).toEqual(
        selectIndexedFragments(pool, request),
    );
});

test("block reranking changes selection without changing native limits or provenance", () => {
    const policy: IndexedFragmentPolicy = {
        selectBlocks: ({ nativeBlocks }) =>
            nativeBlocks.map((item) => ({
                ...item,
                score: item.sourceId === "second" ? 100 : 1,
            })),
    };
    const blocks = applyIndexedBlockPolicy(
        policy,
        request,
        [first, second],
        () => [first, second],
    );
    const selected = selectIndexedFragments(blocks, request, policy);
    expect(selected.fragments).toHaveLength(1);
    expect(selected.fragments[0].sourceId).toBe("second");
    const locator = parseIndexedLocator(selected.fragments[0].locator);
    expect(selected.fragments[0].snippet).toBe(
        second.text.slice(locator.start, locator.end),
    );
    expect(selected.readChars).toBeLessThanOrEqual(32000);
});

test("an additive policy can recover an eligible block absent from the native pool", () => {
    const selected = applyIndexedBlockPolicy(
        { selectBlocks: ({ eligibleBlocks }) => [...eligibleBlocks] },
        request,
        [],
        () => [second],
    );
    expect(selected).toEqual([second]);
});

test.each([
    ["foreign source", { ...second, sourceId: "foreign" }],
    ["stale revision", { ...second, revisionId: "stale" }],
    ["different block", { ...second, blockOrdinal: 99 }],
    ["different message", { ...second, messageOrdinal: 99 }],
    ["altered text", { ...second, text: "Injected evidence" }],
    ["invalid score", { ...second, score: Number.NaN }],
    ["infinite score", { ...second, score: Number.POSITIVE_INFINITY }],
])("rejects a block policy returning %s", (_name, invalid) => {
    expect(() =>
        applyIndexedBlockPolicy(
            { selectBlocks: () => [invalid] },
            request,
            [first],
            () => [first, second],
        ),
    ).toThrow("escaped its eligible pool");
});

test("rejects duplicate block identities", () => {
    expect(() =>
        applyIndexedBlockPolicy(
            { selectBlocks: () => [second, { ...second }] },
            request,
            [second],
            () => [second],
        ),
    ).toThrow("escaped its eligible pool");
});

test("host-supplied metadata cannot replace canonical source temporal context", () => {
    const context: NonNullable<IndexedBlock["temporalContext"]> = {
        version: 1,
        sourceRevisionId: "current",
        contextHash: "fixture",
        ownerId: "user",
        role: "user",
        sourceSpan: { start: 0, end: second.text.length },
        inheritedDateEvidence: [],
    };
    const canonical: IndexedBlock = {
        ...second,
        temporalContext: context,
    };
    const result = applyIndexedBlockPolicy(
        {
            selectBlocks: () => [
                {
                    ...canonical,
                    temporalContext: {
                        ...context,
                        role: "assistant",
                    },
                    score: 9,
                },
            ],
        },
        request,
        [canonical],
        () => [canonical],
    );
    expect(result[0].temporalContext).toBe(canonical.temporalContext);
    expect(result[0].score).toBe(9);
});

test("passage policy reorders existing windows before the unchanged read loop", () => {
    const tail = "Budget price is 200000.";
    const source = block(
        "first",
        `${"Budget ordinary background. ".repeat(250)}\n\n${tail}`,
    );
    let candidates = 0;
    const selected = selectIndexedFragments([source], request, {
        rankWindows: ({ windows, windowChars }) => {
            candidates = windows.length;
            expect(windowChars).toBe(2000);
            return [...windows].sort(
                (a, b) =>
                    Number(
                        b.block.text
                            .slice(b.offset, b.offset + windowChars)
                            .includes(tail),
                    ) -
                    Number(
                        a.block.text
                            .slice(a.offset, a.offset + windowChars)
                            .includes(tail),
                    ),
            );
        },
    });
    expect(candidates).toBeGreaterThan(1);
    expect(selected.fragments).toHaveLength(1);
    expect(selected.fragments[0].snippet).toContain(tail);
    const locator = parseIndexedLocator(selected.fragments[0].locator);
    expect(selected.fragments[0].snippet).toBe(
        source.text.slice(locator.start, locator.end),
    );
});

test("identity window ranking preserves the native cross-source interleaving", () => {
    const expanded: IndexedFragmentRequest = {
        ...request,
        maxFragments: 12,
    };
    expect(
        selectIndexedFragments([first, second], expanded, {
            rankWindows: ({ windows }) => [...windows],
        }),
    ).toEqual(selectIndexedFragments([first, second], expanded));
});

test("raw eligibility cannot broaden the request source scope", () => {
    const foreign = block("foreign", "Budget secret.", 100);
    expect(() =>
        applyIndexedBlockPolicy(
            { selectBlocks: () => [foreign] },
            request,
            [first],
            () => [first, foreign],
        ),
    ).toThrow("escaped its eligible pool");
});

test.each(["drop", "duplicate", "invent"] as const)(
    "rejects a window policy that would %s windows",
    (mode) => {
        expect(() =>
            selectIndexedFragments([first], request, {
                rankWindows: ({ windows }) => {
                    if (mode === "drop") return [];
                    if (mode === "duplicate")
                        return [...windows.slice(1), windows[1]];
                    return windows.map((item) => ({ ...item }));
                },
            }),
        ).toThrow("must permute the existing pool");
    },
);

test("intervention exceptions propagate rather than becoming empty retrievals", () => {
    expect(() =>
        applyIndexedBlockPolicy(
            {
                selectBlocks: () => {
                    throw new Error("Lexical index unavailable");
                },
            },
            request,
            [first],
            () => [first],
        ),
    ).toThrow("Lexical index unavailable");
});
