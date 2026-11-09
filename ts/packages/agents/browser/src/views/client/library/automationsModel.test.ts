// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AutomationSummary } from "@typeagent/agent-flows/catalog";
import {
    commonVerbs,
    countBy,
    countView,
    defaultFilters,
    filterAutomations,
    formatRelativeTime,
    isKind,
    sortAutomations,
} from "./automationsModel";

const NOW = Date.parse("2026-10-02T12:00:00Z");

function item(overrides: Partial<AutomationSummary>): AutomationSummary {
    return {
        id: "webflow:x",
        kind: "webflow",
        name: "x",
        description: "",
        status: "active",
        scope: "Any site",
        origin: "recording",
        triggers: 0,
        warnings: [],
        capabilities: [],
        ...overrides,
    };
}

const items: AutomationSummary[] = [
    item({
        id: "webflow:searchAmazon",
        name: "Search Amazon",
        description: "Find products",
        scope: "amazon.com",
    }),
    item({
        id: "powershell:findLarge",
        kind: "powershell",
        name: "Find large files",
        scope: "This machine",
        origin: "reasoning",
        lastRunAt: "2026-10-02T10:00:00Z",
    }),
    item({
        id: "toolMacro:m1",
        kind: "toolMacro",
        name: "Summarize PRs",
        status: "needsReview",
        scope: "C:\\src",
        origin: "trace",
        capabilities: ["validate", "approve", "delete"],
    }),
    item({
        id: "toolMacro:m2",
        kind: "toolMacro",
        name: "Old macro",
        status: "disabled",
        origin: "trace",
        capabilities: ["delete"],
        lastRunAt: "2026-08-01T00:00:00Z",
    }),
];

describe("filterAutomations", () => {
    test("smart views filter by status and recent runs", () => {
        const ids = (view: typeof defaultFilters.view) =>
            filterAutomations(items, { ...defaultFilters, view }, NOW).map(
                (i) => i.id,
            );
        expect(ids("needsReview")).toEqual(["toolMacro:m1"]);
        expect(ids("disabled")).toEqual(["toolMacro:m2"]);
        expect(ids("recent")).toEqual(["powershell:findLarge"]);
        expect(ids("all")).toHaveLength(4);
    });

    test("search matches name, description, scope and origin", () => {
        const search = (text: string) =>
            filterAutomations(items, { ...defaultFilters, search: text }, NOW);
        expect(search("amazon").map((i) => i.id)).toEqual([
            "webflow:searchAmazon",
        ]);
        expect(search("products")).toHaveLength(1);
        expect(search("reasoning")).toHaveLength(1);
        expect(search("  ")).toHaveLength(4);
    });

    test("facets combine", () => {
        const result = filterAutomations(
            items,
            { ...defaultFilters, kind: "toolMacro", origin: "trace" },
            NOW,
        );
        expect(result).toHaveLength(2);
        expect(
            filterAutomations(
                items,
                { ...defaultFilters, kind: "toolMacro", scope: "C:\\src" },
                NOW,
            ),
        ).toHaveLength(1);
    });
});

describe("sorting and counting", () => {
    test("sorts by status with review first, and reverses", () => {
        const asc = sortAutomations(items, {
            sort: "status",
            sortDescending: false,
        });
        expect(asc[0].status).toBe("needsReview");
        expect(asc.at(-1)?.status).toBe("disabled");
        const desc = sortAutomations(items, {
            sort: "status",
            sortDescending: true,
        });
        expect(desc[0].status).toBe("disabled");
    });

    test("last run sorts most recent first and never-run last", () => {
        const sorted = sortAutomations(items, {
            sort: "lastRun",
            sortDescending: false,
        });
        expect(sorted[0].id).toBe("powershell:findLarge");
        expect(sorted[1].id).toBe("toolMacro:m2");
    });

    test("does not mutate the input", () => {
        const copy = [...items];
        sortAutomations(items, { sort: "name", sortDescending: true });
        expect(items).toEqual(copy);
    });

    test("counts by kind and view", () => {
        expect(countBy(items, (i) => i.kind).get("toolMacro")).toBe(2);
        expect(countView(items, "needsReview", NOW)).toBe(1);
    });
});

describe("helpers", () => {
    test("formats relative times", () => {
        expect(formatRelativeTime(undefined, NOW)).toBe("never");
        expect(formatRelativeTime("2026-10-02T11:59:50Z", NOW)).toBe(
            "just now",
        );
        expect(formatRelativeTime("2026-10-02T11:30:00Z", NOW)).toBe(
            "30 min ago",
        );
        expect(formatRelativeTime("2026-10-02T06:00:00Z", NOW)).toBe("6 h ago");
        expect(formatRelativeTime("2026-09-27T12:00:00Z", NOW)).toBe("5 d ago");
        expect(formatRelativeTime("garbage", NOW)).toBe("unknown");
    });

    test("bulk verbs are the intersection of capabilities", () => {
        expect([...commonVerbs([items[2], items[3]])]).toEqual(["delete"]);
        expect(commonVerbs([])).toEqual(new Set());
    });

    test("recognizes valid kinds", () => {
        expect(isKind("powershell")).toBe(true);
        expect(isKind("nope")).toBe(false);
        expect(isKind(null)).toBe(false);
    });
});
