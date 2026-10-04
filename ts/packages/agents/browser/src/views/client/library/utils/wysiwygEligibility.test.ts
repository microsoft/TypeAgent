// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { canEditWysiwyg } from "./wysiwygEligibility";

test("plain Markdown with tables, code and diagrams is editable", () => {
    expect(
        canEditWysiwyg(
            "# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\ngraph TD; A-->B\n```\n\nSee <https://example.com> and a < b > c.",
        ),
    ).toBe(true);
});

test("raw HTML falls back to the text editor", () => {
    expect(canEditWysiwyg("hello <b>bold</b>")).toBe(false);
    expect(canEditWysiwyg("<img src=x onerror=alert(1)>")).toBe(false);
    expect(canEditWysiwyg("<div class='x'>\ntext\n</div>")).toBe(false);
});

test("images fall back so imported URLs are never fetched", () => {
    expect(canEditWysiwyg("![alt](https://example.com/a.png)")).toBe(false);
});
