// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    indexedTextHash,
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
