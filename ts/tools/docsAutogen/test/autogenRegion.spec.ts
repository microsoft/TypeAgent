// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { findAutogenRegion, writeAutogenRegion } from "../src/autogenRegion.js";

describe("findAutogenRegion", () => {
    it("returns null when there are no markers", () => {
        expect(findAutogenRegion("# foo\n\nbody\n")).toBeNull();
    });
    it("extracts body between markers, trimming surrounding blanks", () => {
        const text = [
            "# foo",
            "",
            "<!-- AUTOGEN:DOCS:START -->",
            "",
            "block content",
            "more content",
            "",
            "<!-- AUTOGEN:DOCS:END -->",
            "",
            "after",
            "",
        ].join("\n");
        const region = findAutogenRegion(text);
        expect(region).not.toBeNull();
        expect(region!.body).toBe("block content\nmore content");
    });
    it("throws when START is found without END", () => {
        const text = "# foo\n<!-- AUTOGEN:DOCS:START -->\nbody\n";
        expect(() => findAutogenRegion(text)).toThrow(/END marker/u);
    });
});

describe("writeAutogenRegion", () => {
    it("replaces existing region in place", () => {
        const before = [
            "# foo",
            "",
            "<!-- AUTOGEN:DOCS:START -->",
            "old body",
            "<!-- AUTOGEN:DOCS:END -->",
            "",
            "## Trademarks",
            "tm",
            "",
        ].join("\n");
        const after = writeAutogenRegion(
            before,
            "new body line 1\nnew body line 2",
        );
        expect(after).toContain("new body line 1");
        expect(after).toContain("new body line 2");
        expect(after).not.toContain("old body");
        expect(after).toContain("## Trademarks");
        expect(after.indexOf("# foo")).toBeLessThan(
            after.indexOf("<!-- AUTOGEN:DOCS:START -->"),
        );
    });
    it("inserts before ## Trademarks when no markers exist", () => {
        const before = [
            "# foo",
            "",
            "intro paragraph",
            "",
            "## Trademarks",
            "tm",
            "",
        ].join("\n");
        const after = writeAutogenRegion(before, "fresh body");
        const startIdx = after.indexOf("<!-- AUTOGEN:DOCS:START -->");
        const endIdx = after.indexOf("<!-- AUTOGEN:DOCS:END -->");
        const tmIdx = after.indexOf("## Trademarks");
        expect(startIdx).toBeGreaterThan(0);
        expect(endIdx).toBeGreaterThan(startIdx);
        expect(tmIdx).toBeGreaterThan(endIdx);
        expect(after).toContain("fresh body");
        expect(after).toContain("intro paragraph");
    });
    it("inserts after H1 when no Trademarks heading exists", () => {
        const before = ["# foo", "", "intro", ""].join("\n");
        const after = writeAutogenRegion(before, "body");
        const h1Idx = after.indexOf("# foo");
        const startIdx = after.indexOf("<!-- AUTOGEN:DOCS:START -->");
        expect(startIdx).toBeGreaterThan(h1Idx);
        expect(after).toContain("body");
    });
    it("preserves content after the END marker on replacement", () => {
        const before = [
            "# foo",
            "<!-- AUTOGEN:DOCS:START -->",
            "old",
            "<!-- AUTOGEN:DOCS:END -->",
            "",
            "## Trademarks",
            "tm",
        ].join("\n");
        const after = writeAutogenRegion(before, "new");
        expect(after).toContain("## Trademarks");
        expect(after).toContain("tm");
    });
});
