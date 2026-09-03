// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    encodeDocumentPathForUrl,
    ensureMarkdownExtension,
    parseDocumentPathFromUrl,
} from "../src/view/route/urlPath.js";

describe("markdown document URL paths", () => {
    test("round-trips nested paths and independently encoded segments", () => {
        expect(parseDocumentPathFromUrl("/document/team/2025/plan.md")).toBe(
            "team/2025/plan.md",
        );
        expect(
            parseDocumentPathFromUrl("/document/team%20a/plan%20v2.md"),
        ).toBe("team a/plan v2.md");
        expect(encodeDocumentPathForUrl("team a/plan v2.md")).toBe(
            "team%20a/plan%20v2",
        );
    });

    test("rejects empty, malformed, and encoded-separator paths", () => {
        for (const url of [
            "/",
            "/document/",
            "/document//foo",
            "/document/foo//bar",
            "/document/broken%GZ",
            "/document/team%2Fplan.md",
            "/document/team%5Cplan.md",
        ]) {
            expect(parseDocumentPathFromUrl(url)).toBeNull();
        }
    });

    test("normalizes the extension without flattening the path", () => {
        expect(ensureMarkdownExtension("team/plan")).toBe("team/plan.md");
        expect(ensureMarkdownExtension("team/plan.md")).toBe("team/plan.md");
        expect(ensureMarkdownExtension("team/plan.MD")).toBe("team/plan.MD");
    });
});
