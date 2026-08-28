// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseDocumentPathFromUrl,
    ensureMarkdownExtension,
    encodeDocumentPathForUrl,
} from "../src/view/route/urlPath.js";

describe("parseDocumentPathFromUrl", () => {
    // Regression for Fix #2: the browser previously used
    // /\/document\/([^\/]+)/, which captured only the first segment of
    // a nested path. `parseDocumentPathFromUrl` now preserves the full
    // relative path and decodes each segment independently so slashes,
    // dots, and spaces round-trip.
    test("returns the full nested path", () => {
        expect(parseDocumentPathFromUrl("/document/team/2025/plan.md")).toBe(
            "team/2025/plan.md",
        );
    });

    test("decodes each segment independently", () => {
        expect(parseDocumentPathFromUrl("/document/my%20notes.md")).toBe(
            "my notes.md",
        );
        expect(
            parseDocumentPathFromUrl("/document/team%20a/2025/plan%20v2.md"),
        ).toBe("team a/2025/plan v2.md");
    });

    test("returns null when the URL is not a /document route", () => {
        expect(parseDocumentPathFromUrl("/")).toBeNull();
        expect(parseDocumentPathFromUrl("/other/thing")).toBeNull();
        expect(parseDocumentPathFromUrl("/documents/foo")).toBeNull();
    });

    test("returns null for empty or malformed document paths", () => {
        expect(parseDocumentPathFromUrl("/document/")).toBeNull();
        expect(parseDocumentPathFromUrl("/document//foo")).toBeNull();
        expect(parseDocumentPathFromUrl("/document/foo//bar")).toBeNull();
        // Undecodable percent sequence.
        expect(parseDocumentPathFromUrl("/document/broken%GZ")).toBeNull();
        expect(parseDocumentPathFromUrl("/document/team%2Fplan.md")).toBeNull();
        expect(parseDocumentPathFromUrl("/document/team%5Cplan.md")).toBeNull();
    });

    test("strips a single trailing slash", () => {
        expect(parseDocumentPathFromUrl("/document/team/plan.md/")).toBe(
            "team/plan.md",
        );
    });

    test("guards against non-string input", () => {
        expect(
            parseDocumentPathFromUrl(undefined as unknown as string),
        ).toBeNull();
        expect(parseDocumentPathFromUrl(null as unknown as string)).toBeNull();
    });
});

describe("ensureMarkdownExtension", () => {
    test("appends .md when missing", () => {
        expect(ensureMarkdownExtension("team/plan")).toBe("team/plan.md");
    });

    describe("encodeDocumentPathForUrl", () => {
        test("preserves nested path separators and encodes spaces per segment", () => {
            expect(encodeDocumentPathForUrl("team/2025/plan.md")).toBe(
                "team/2025/plan",
            );
            expect(encodeDocumentPathForUrl("my notes.md")).toBe("my%20notes");
            expect(encodeDocumentPathForUrl("team a/plan v2.md")).toBe(
                "team%20a/plan%20v2",
            );
        });
    });
    test("does not double-append", () => {
        expect(ensureMarkdownExtension("team/plan.md")).toBe("team/plan.md");
        expect(ensureMarkdownExtension("team/plan.MD")).toBe("team/plan.MD");
    });
});
