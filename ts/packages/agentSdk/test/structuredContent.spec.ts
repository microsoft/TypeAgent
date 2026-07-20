// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    StructuredBlock,
    StructuredContent,
    TableColumn,
    TableCell,
} from "../src/display.js";
import {
    ColumnSpec,
    createStructuredContent,
    createTable,
    fromRecords,
    getStructuredFallback,
    isStructuredContent,
    structuredToMarkdown,
    structuredToText,
} from "../src/helpers/displayHelpers.js";
import { createStructuredResult } from "../src/helpers/actionHelpers.js";

describe("structured content builders", () => {
    it("createTable builds a table block with defaults", () => {
        const columns: TableColumn[] = [
            { id: "n", header: "N" },
            { id: "t", header: "Title" },
        ];
        const rows: TableCell[][] = [[1, "one"]];
        const table = createTable(columns, rows);
        expect(table).toEqual({ kind: "table", columns, rows });
    });

    it("createTable carries affordance options", () => {
        const table = createTable([{ id: "a", header: "A" }], [["x"]], {
            caption: "cap",
            readonly: true,
            filterable: true,
        });
        expect(table.caption).toBe("cap");
        expect(table.readonly).toBe(true);
        expect(table.filterable).toBe(true);
    });

    it("fromRecords builds a table + stashes rawData together", () => {
        type PR = { number: number; title: string; url: string };
        const prs: PR[] = [
            { number: 1, title: "First", url: "https://x/1" },
            { number: 2, title: "Second", url: "https://x/2" },
        ];
        const spec: ColumnSpec<PR>[] = [
            {
                id: "number",
                header: "#",
                type: "link",
                value: (pr) => ({ text: `#${pr.number}`, href: pr.url }),
            },
            { id: "title", header: "Title", value: (pr) => pr.title },
        ];
        const content = fromRecords(prs, spec);
        expect(content.type).toBe("structured");
        expect(content.blocks).toHaveLength(1);
        const table = content.blocks[0];
        expect(table.kind).toBe("table");
        if (table.kind === "table") {
            // value accessor stripped from column definition
            expect(table.columns).toEqual([
                { id: "number", header: "#", type: "link" },
                { id: "title", header: "Title" },
            ]);
            expect(table.rows).toEqual([
                [{ text: "#1", href: "https://x/1" }, "First"],
                [{ text: "#2", href: "https://x/2" }, "Second"],
            ]);
        }
        // rawData defaults to the original objects
        expect(content.rawData).toBe(prs);
    });

    it("fromRecords allows overriding rawData", () => {
        const content = fromRecords(
            [{ a: 1 }],
            [{ id: "a", header: "A", value: (o) => o.a }],
            { rawData: { custom: true } },
        );
        expect(content.rawData).toEqual({ custom: true });
    });

    it("createStructuredContent attaches markdown + text alternates", () => {
        const content = createStructuredContent([
            { kind: "heading", text: "Hi" },
        ]);
        expect(content.alternates).toEqual([
            { type: "markdown", content: "# Hi" },
            { type: "text", content: "Hi" },
        ]);
    });

    it("createStructuredContent omits undefined optional fields", () => {
        const content = createStructuredContent([{ kind: "divider" }]);
        expect("rawData" in content).toBe(false);
        expect("kind" in content).toBe(false);
        expect("speak" in content).toBe(false);
    });
});

describe("createStructuredResult", () => {
    it("wraps blocks into an ActionResultSuccess with derived history text", () => {
        const result = createStructuredResult(
            [{ kind: "heading", text: "Report" }],
            { rawData: [1, 2, 3] },
        );
        expect(result.entities).toEqual([]);
        expect(result.historyText).toBe("Report");
        const display = result.displayContent as StructuredContent;
        expect(display.type).toBe("structured");
        expect(display.rawData).toEqual([1, 2, 3]);
    });

    it("honors an explicit historyText and entities", () => {
        const result = createStructuredResult([{ kind: "divider" }], {
            historyText: "custom",
            entities: [{ name: "e", type: ["t"] }],
        });
        expect(result.historyText).toBe("custom");
        expect(result.entities).toEqual([{ name: "e", type: ["t"] }]);
    });
});

describe("isStructuredContent", () => {
    it("detects structured content and rejects other display content", () => {
        const content = createStructuredContent([{ kind: "divider" }]);
        expect(isStructuredContent(content)).toBe(true);
        expect(isStructuredContent("plain")).toBe(false);
        expect(isStructuredContent(["a", "b"])).toBe(false);
        expect(isStructuredContent({ type: "text", content: "x" })).toBe(false);
    });
});

describe("structuredToMarkdown", () => {
    it("renders a table with link cells", () => {
        const blocks: StructuredBlock[] = [
            {
                kind: "table",
                columns: [
                    { id: "n", header: "#" },
                    { id: "t", header: "Title" },
                ],
                rows: [
                    [{ text: "#1", href: "https://x/1" }, "First"],
                    [2, "Second"],
                ],
            },
        ];
        expect(structuredToMarkdown(blocks)).toBe(
            [
                "| # | Title |",
                "| --- | --- |",
                "| [#1](https://x/1) | First |",
                "| 2 | Second |",
            ].join("\n"),
        );
    });

    it("renders headings, lists, images, code, and dividers", () => {
        const blocks: StructuredBlock[] = [
            { kind: "heading", text: "Title", level: 2 },
            {
                kind: "list",
                items: [
                    { text: "one", href: "https://x/1", subtitle: "sub" },
                    { text: "two" },
                ],
            },
            { kind: "image", src: "https://x/i.png", alt: "pic", caption: "c" },
            { kind: "code", code: "x=1", language: "python" },
            { kind: "divider" },
        ];
        expect(structuredToMarkdown(blocks)).toBe(
            [
                "## Title",
                "",
                "- [one](https://x/1) — sub\n- two",
                "",
                "![pic](https://x/i.png)\n\n*c*",
                "",
                "```python\nx=1\n```",
                "",
                "---",
            ].join("\n"),
        );
    });

    it("renders an ordered list and keyValue block", () => {
        const blocks: StructuredBlock[] = [
            {
                kind: "list",
                ordered: true,
                items: [{ text: "first" }, { text: "second" }],
            },
            {
                kind: "keyValue",
                pairs: [
                    { label: "Owner", value: "octocat" },
                    {
                        label: "Repo",
                        value: { text: "typeagent", href: "https://x" },
                    },
                ],
            },
        ];
        expect(structuredToMarkdown(blocks)).toBe(
            [
                "1. first\n2. second",
                "",
                "- **Owner:** octocat\n- **Repo:** [typeagent](https://x)",
            ].join("\n"),
        );
    });
});

describe("structuredToText", () => {
    it("renders an aligned text table", () => {
        const blocks: StructuredBlock[] = [
            {
                kind: "table",
                columns: [
                    { id: "n", header: "#" },
                    { id: "t", header: "Title" },
                ],
                rows: [
                    [{ text: "#1", href: "https://x/1" }, "First"],
                    ["#22", "Second"],
                ],
            },
        ];
        expect(structuredToText(blocks)).toBe(
            ["#    Title ", "---  ------", "#1   First ", "#22  Second"].join(
                "\n",
            ),
        );
    });

    it("strips link/badge decoration and renders plain lines", () => {
        const blocks: StructuredBlock[] = [
            { kind: "heading", text: "H" },
            {
                kind: "keyValue",
                pairs: [
                    {
                        label: "Repo",
                        value: { text: "typeagent", href: "https://x" },
                    },
                ],
            },
            { kind: "image", src: "https://x/i.png", alt: "pic" },
        ];
        expect(structuredToText(blocks)).toBe(
            ["H", "", "Repo: typeagent", "", "[image: pic]"].join("\n"),
        );
    });
});

describe("getStructuredFallback", () => {
    it("prefers an existing alternate", () => {
        const content = createStructuredContent([
            { kind: "heading", text: "Hi" },
        ]);
        expect(getStructuredFallback(content, "markdown")).toBe("# Hi");
        expect(getStructuredFallback(content, "text")).toBe("Hi");
    });

    it("derives on demand when no alternate is present", () => {
        const content: StructuredContent = {
            type: "structured",
            blocks: [{ kind: "heading", text: "Hi" }],
        };
        expect(getStructuredFallback(content, "markdown")).toBe("# Hi");
        expect(getStructuredFallback(content, "text")).toBe("Hi");
    });
});
