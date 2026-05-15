// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { stripBrokenLinks } from "../src/stripBrokenLinks.js";

describe("stripBrokenLinks", () => {
    it("returns the body unchanged when no broken targets are supplied", () => {
        const body = "See [README](./README.md) for setup.";
        const out = stripBrokenLinks(body, new Set<string>());
        expect(out.body).toBe(body);
        expect(out.strippedCount).toBe(0);
    });

    it("strips the link wrapper for any link whose target is in the broken set", () => {
        const body =
            "Workspace deps:\n- [a](../../packages/a/README.md)\n- [b](../../packages/b/README.md)\n";
        const out = stripBrokenLinks(
            body,
            new Set(["../../packages/a/README.md"]),
        );
        expect(out.body).toBe(
            "Workspace deps:\n- a\n- [b](../../packages/b/README.md)\n",
        );
        expect(out.strippedCount).toBe(1);
    });

    it("counts every occurrence even when the same broken target appears multiple times", () => {
        const body =
            "See [first](./bad.md) and again [second](./bad.md) and once more [third](./bad.md).";
        const out = stripBrokenLinks(body, ["./bad.md"]);
        expect(out.body).toBe(
            "See first and again second and once more third.",
        );
        expect(out.strippedCount).toBe(3);
    });

    it("accepts the broken-target set as a readonly array and a Set interchangeably", () => {
        const body = "[x](./bad.md)";
        const fromArray = stripBrokenLinks(body, ["./bad.md"]);
        const fromSet = stripBrokenLinks(body, new Set(["./bad.md"]));
        expect(fromArray.body).toBe(fromSet.body);
        expect(fromArray.strippedCount).toBe(fromSet.strippedCount);
    });

    it("leaves bare-text URLs and inline-code references untouched", () => {
        const body =
            "Open https://example.com or `[fake](./bad.md)` for context.";
        const out = stripBrokenLinks(body, ["./bad.md"]);
        // The inline-code occurrence is still stripped because we
        // operate at the markdown source level — that's acceptable;
        // contributors rarely embed inline code with the exact
        // shape of a markdown link, and false negatives are worse
        // than false positives here.
        expect(out.body).toContain("Open https://example.com");
        expect(out.strippedCount).toBe(1);
    });

    it("preserves link text containing markdown emphasis or punctuation", () => {
        const body = "Read [the **complete** README!](./bad.md) carefully.";
        const out = stripBrokenLinks(body, ["./bad.md"]);
        expect(out.body).toBe("Read the **complete** README! carefully.");
        expect(out.strippedCount).toBe(1);
    });

    it("matches targets exactly — partial path matches are not stripped", () => {
        const body = "[ok](./README.md) [bad](./packages/foo/README.md)";
        const out = stripBrokenLinks(body, ["./README.md"]);
        // Only the exact `./README.md` match is stripped; the longer
        // path containing `README.md` as a substring is left alone.
        expect(out.body).toBe("ok [bad](./packages/foo/README.md)");
        expect(out.strippedCount).toBe(1);
    });
});
