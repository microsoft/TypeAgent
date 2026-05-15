// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { extractMarkdownLinks } from "../src/linkExtraction.js";

describe("extractMarkdownLinks", () => {
    it("extracts inline filesystem links", () => {
        const md = "see [foo](./src/foo.ts) and [bar](../bar.md).";
        const links = extractMarkdownLinks(md);
        expect(links.map((l) => l.target)).toEqual([
            "./src/foo.ts",
            "../bar.md",
        ]);
        expect(links[0]?.text).toBe("foo");
        expect(links[0]?.line).toBe(1);
    });
    it("skips http(s):// and other URL schemes", () => {
        const md =
            "[a](https://example.com) [b](mailto:x@y.com) [c](./local.ts)";
        const links = extractMarkdownLinks(md);
        expect(links.map((l) => l.target)).toEqual(["./local.ts"]);
    });
    it("skips anchor-only links", () => {
        const md = "[foo](#bar) [baz](./file.md)";
        const links = extractMarkdownLinks(md);
        expect(links.map((l) => l.target)).toEqual(["./file.md"]);
    });
    it("skips links inside fenced code blocks", () => {
        const md = [
            "before [a](./a.ts)",
            "```ts",
            "[ignored](./b.ts)",
            "```",
            "after [c](./c.ts)",
        ].join("\n");
        const links = extractMarkdownLinks(md);
        expect(links.map((l) => l.target)).toEqual(["./a.ts", "./c.ts"]);
    });
    it("respects different fence markers (~~~ vs ```)", () => {
        const md = [
            "[a](./a.ts)",
            "~~~",
            "[ignored](./b.ts)",
            "~~~",
            "[c](./c.ts)",
        ].join("\n");
        const links = extractMarkdownLinks(md);
        expect(links.map((l) => l.target)).toEqual(["./a.ts", "./c.ts"]);
    });
    it("captures multiple links on the same line", () => {
        const md = "[a](./a.ts) [b](./b.ts) [c](./c.ts)";
        const links = extractMarkdownLinks(md);
        expect(links.map((l) => l.target)).toEqual([
            "./a.ts",
            "./b.ts",
            "./c.ts",
        ]);
        for (const l of links) expect(l.line).toBe(1);
    });
    it("ignores reference-style links", () => {
        const md = "see [foo][1].\n\n[1]: ./foo.ts";
        const links = extractMarkdownLinks(md);
        expect(links).toEqual([]);
    });
});
