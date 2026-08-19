import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    generateReleaseNotes,
    groupChanges,
    normalizeKind,
    type Change,
} from "./releaseNotes.js";

describe("release notes generator", () => {
    it("normalizes change kinds without case sensitivity", () => {
        assert.equal(normalizeKind("FIX"), "fix");
        assert.equal(normalizeKind(" Feature "), "feature");
    });

    it("deduplicates repeated change IDs", () => {
        const sections = groupChanges([
            { id: "42", area: "Dispatcher", title: "First title", kind: "fix" },
            {
                id: "42",
                area: "Dispatcher",
                title: "Reworded title",
                kind: "fix",
            },
        ]);
        assert.equal(sections[0].changes.length, 1);
    });

    it("sorts numeric change IDs numerically", () => {
        const sections = groupChanges([
            { id: "10", area: "CLI", title: "Tenth", kind: "fix" },
            { id: "2", area: "CLI", title: "Second", kind: "feature" },
        ]);
        assert.deepEqual(
            sections[0].changes.map((change) => change.id),
            ["2", "10"],
        );
    });

    it("escapes Markdown table separators in change titles", () => {
        const markdown = generateReleaseNotes([
            {
                id: "7",
                area: "Browser",
                title: "Handle search | lookup fallback",
                kind: "fix",
            },
        ]);
        assert.ok(markdown.includes("Handle search \\| lookup fallback"));
    });

    it("groups sections alphabetically", () => {
        const changes: Change[] = [
            { id: "1", area: "Shell", title: "Shell update", kind: "feature" },
            { id: "2", area: "Browser", title: "Browser update", kind: "docs" },
        ];
        assert.deepEqual(
            groupChanges(changes).map((section) => section.area),
            ["Browser", "Shell"],
        );
    });
});
