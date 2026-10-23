// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    indexedTextHash,
    indexedQueryTerms,
    parseIndexedLocator,
    selectIndexedFragments,
    type IndexedBlock,
} from "../src/indexedFragments.js";
import type { IndexedFragmentRequest } from "../src/types.js";

function select(
    text: string,
    terms: string[],
    bounds: Partial<IndexedFragmentRequest> = {},
) {
    const block: IndexedBlock = {
        sourceId: "eligible",
        revisionId: "current",
        blockOrdinal: 0,
        text,
        score: 1,
    };
    const result = selectIndexedFragments([block], {
        terms,
        sourceIds: [block.sourceId],
        ...bounds,
    });
    expect(result.readChars).toBeLessThanOrEqual(bounds.maxReadChars ?? 32000);
    expect(result.fragments.length).toBeLessThanOrEqual(
        bounds.maxFragments ?? 12,
    );
    for (const fragment of result.fragments) {
        const range = parseIndexedLocator(fragment.locator);
        expect(range.hash).toBe(indexedTextHash(text));
        expect(range.end - range.start).toBeLessThanOrEqual(
            bounds.maxCharsPerFragment ?? 2000,
        );
        expect(fragment.snippet).toBe(text.slice(range.start, range.end));
        expect(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(fragment.snippet)).toBe(
            false,
        );
    }
    return result;
}

test("late relevant matches stay inside their bounded windows rather than relocating to a long paragraph prefix", () => {
    const qualification =
        "Reservation exception: the measured sample must be withdrawn if duplicate events are discovered. " +
        "Local observations do not authorize a universal capacity target. ".repeat(
            9,
        );
    const text = `# Reservation review\n\n${"Ordinary background. ".repeat(600)}${qualification}`;
    const selected = select(text, ["Reservation exception"]);
    expect(
        selected.fragments.some((fragment) =>
            fragment.snippet.includes(qualification),
        ),
    ).toBe(true);
    expect(
        selected.fragments.some((fragment) =>
            fragment.snippet.includes("# Reservation review"),
        ),
    ).toBe(true);
});

test("late table cells outrank repeated early individual query words and keep associated headings and table headers", () => {
    const qualification =
        "Release approval requirement: an authorized reviewer must confirm the current scope before deployment.";
    const heading = "## Regional authorization";
    const header = "| Region | Evidence |";
    const text = `# Observations\n\n${heading}\n\n${header}\n| --- | --- |\n| west | ${"release approval baseline; ".repeat(800)}${qualification} |\n`;
    const selected = select(text, ["Release approval requirement"]);
    expect(
        selected.fragments.some((fragment) =>
            fragment.snippet.includes(qualification),
        ),
    ).toBe(true);
    expect(
        selected.fragments.some((fragment) =>
            fragment.snippet.includes(heading),
        ),
    ).toBe(true);
    expect(
        selected.fragments.some((fragment) =>
            fragment.snippet.includes(header),
        ),
    ).toBe(true);
});

test("repeated early literal matches cannot hide a late literal clarification", () => {
    const late =
        "Budget review correction: the former denominator is withdrawn; only this current cohort is supported.";
    const text = `${"Budget review ordinary local observation. ".repeat(900)}${late}`;
    const selected = select(text, ["Budget review"]);
    expect(
        selected.fragments.some((fragment) => fragment.snippet.includes(late)),
    ).toBe(true);
});

test("distant in-paragraph qualifications are read without repeating the selector", () => {
    const qualification =
        "Caveat: the comparison is limited to the rehearsed cohort and does not prove readiness.";
    const text = `# Horizon rollout\n\nHorizon rollout local outcome. ${"Background observation. ".repeat(900)}${qualification}`;
    const selected = select(text, ["Horizon rollout"]);
    expect(
        selected.fragments.some((fragment) =>
            fragment.snippet.includes(qualification),
        ),
    ).toBe(true);
});

test("case-insensitive matches retain original UTF-16 offsets and neither boundary splits a surrogate pair", () => {
    const text = `${"İ😀".repeat(2200)}Readiness exception: current authorization remains absent. ${"😀".repeat(1500)}`;
    const selected = select(text, ["READINESS EXCEPTION"]);
    expect(
        selected.fragments.some((fragment) =>
            fragment.snippet.includes(
                "Readiness exception: current authorization remains absent.",
            ),
        ),
    ).toBe(true);
});

test("ordinary source scope and smaller read/fragment limits remain authoritative", () => {
    const text = `Approval scope. ${"Approval scope remains uncertain. ".repeat(2000)}`;
    const selected = select(text, ["Approval scope"], {
        maxFragments: 2,
        maxCharsPerFragment: 500,
        maxReadChars: 1200,
    });
    expect(selected.fragments.length).toBeGreaterThan(0);
    expect(selected.limited).toBe(true);
    expect(
        select(text, ["Approval scope"], { sourceIds: ["excluded"] }).fragments,
    ).toEqual([]);
});

test("full-question terms retain late named events and temporal operators", () => {
    const terms = indexedQueryTerms(
        "How many days passed between the day I replaced my spark plugs and the day I participated in the Turbocharged Tuesdays auto racking event after the initial repair?",
    );
    expect(terms).toEqual(
        expect.arrayContaining([
            "spark",
            "plugs",
            "turbocharged",
            "tuesdays",
            "event",
            "after",
            "initial",
        ]),
    );
    expect(terms).not.toContain("my");
    expect(terms.length).toBeGreaterThan(8);
    expect(
        select("Turbocharged Tuesdays event today.", terms, {
            query: "When was the Turbocharged Tuesdays event?",
        }).fragments.length,
    ).toBeGreaterThan(0);
});

test("QA retains a second relevant same-source operand ahead of generic diversity signals", () => {
    const blocks = [
        {
            sourceId: "race",
            score: 100,
            text: "I replaced spark plugs a while back.",
        },
        {
            sourceId: "race",
            score: 90,
            text: "Turbocharged Tuesdays participation today, March 15.",
        },
        {
            sourceId: "other1",
            score: 3,
            text: "Only a qualified observation.",
        },
        { sourceId: "other2", score: 2, text: "This attempt failed." },
        { sourceId: "other3", score: 1, text: "Success was observed." },
    ].map((block, blockOrdinal) => ({
        revisionId: "r1",
        blockOrdinal,
        ...block,
    }));
    const request: IndexedFragmentRequest = {
        query: "When did I replace spark plugs and participate in Turbocharged Tuesdays?",
        terms: ["spark", "plugs", "turbocharged", "tuesdays"],
        sourceIds: blocks.map((block) => block.sourceId),
        maxFragments: 4,
    };
    const ordinary = selectIndexedFragments(blocks, request);
    const observed = selectIndexedFragments(blocks, {
        ...request,
        includeDiagnostics: true,
    });
    expect(ordinary.fragments.map((fragment) => fragment.snippet)).toEqual(
        expect.arrayContaining([blocks[0].text, blocks[1].text]),
    );
    expect(observed.fragments).toEqual(ordinary.fragments);
    expect(observed.readChars).toBe(ordinary.readChars);
    expect(ordinary.diagnostics).toBeUndefined();
    expect(observed.diagnostics?.blocks.map((block) => block.selected)).toEqual(
        [true, true, true, true, false],
    );
    expect(observed.diagnostics?.blocks[4].reason).toBe("block-limit");
    const view = selectIndexedFragments(blocks, {
        terms: request.terms,
        sourceIds: request.sourceIds,
        maxFragments: 4,
    });
    expect(
        view.fragments.some((fragment) => fragment.snippet === blocks[1].text),
    ).toBe(false);
});

test("QA uses its fragment budget across more than four relevant blocks before expanding long turns", () => {
    const blocks: IndexedBlock[] = Array.from(
        { length: 7 },
        (_, blockOrdinal) => ({
            sourceId: "same-session",
            revisionId: "current",
            blockOrdinal,
            score: 100 - blockOrdinal,
            text: `Evidence ${blockOrdinal}. ${"long retrospective discussion ".repeat(blockOrdinal === 0 ? 120 : 1)}`,
        }),
    );
    const selected = selectIndexedFragments(blocks, {
        query: "Compare all the recorded evidence.",
        terms: ["evidence"],
        sourceIds: ["same-session"],
    });
    expect(
        new Set(
            selected.fragments.map(
                (fragment) =>
                    parseIndexedLocator(fragment.locator).blockOrdinal,
            ),
        ).size,
    ).toBe(7);
    expect(selected.fragments.length).toBeLessThanOrEqual(12);
    expect(selected.readChars).toBeLessThanOrEqual(32000);
});
