// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Unit tests for the conceptual-docs grounding (docs.ts) and the explain
// renderer (render.ts). No LLM is involved - synthetic markdown exercises the
// same heading chunking and keyword selection the bundled overview docs use.

import {
    chunkMarkdown,
    DocChunk,
    formatDocsGrounding,
    selectDocChunks,
} from "../src/docs.js";
import { HelpResponse } from "../src/helpResponseSchema.js";
import { renderHelp } from "../src/render.js";

const SAMPLE = `# TypeAgent

TypeAgent is a personal agent.

## What is TypeAgent?

It routes natural language to application agents.

## Setup

Install and configure it.

### Windows

Use PowerShell.
`;

describe("chunkMarkdown", () => {
    test("splits at H1/H2 and keeps H3 inside its parent section", () => {
        const chunks = chunkMarkdown("index.md", SAMPLE);
        const headings = chunks.map((c) => c.heading);
        expect(headings).toEqual(["TypeAgent", "What is TypeAgent?", "Setup"]);
        // The H3 "Windows" is folded into the "Setup" chunk, not its own chunk.
        const setup = chunks.find((c) => c.heading === "Setup")!;
        expect(setup.text).toContain("### Windows");
        expect(setup.text).toContain("Use PowerShell.");
    });

    test("every chunk carries its source and is unpinned by default", () => {
        const chunks = chunkMarkdown("getting-started.md", SAMPLE);
        expect(chunks.every((c) => c.source === "getting-started.md")).toBe(
            true,
        );
        expect(chunks.every((c) => c.pinned === false)).toBe(true);
    });
});

function makeChunks(): DocChunk[] {
    return [
        {
            source: "index.md",
            heading: "TypeAgent",
            text: "TypeAgent is a personal agent overview.",
            pinned: true,
        },
        {
            source: "index.md",
            heading: "What is TypeAgent?",
            text: "It routes natural language to application agents.",
            pinned: true,
        },
        {
            source: "service-keys.md",
            heading: "Service keys",
            text: "Configure Azure OpenAI keys to run TypeAgent.",
            pinned: false,
        },
        {
            source: "setup-windows.md",
            heading: "Windows setup",
            text: "Install pnpm and build the shell on Windows.",
            pinned: false,
        },
    ];
}

describe("selectDocChunks", () => {
    test("always includes pinned chunks even when nothing else matches", () => {
        const selected = selectDocChunks(makeChunks(), "xyzzy nothing matches");
        expect(selected.map((c) => c.heading)).toEqual([
            "TypeAgent",
            "What is TypeAgent?",
        ]);
    });

    test("adds the highest-overlap chunk for a keyword question", () => {
        const selected = selectDocChunks(
            makeChunks(),
            "how do I configure keys",
        );
        expect(selected.map((c) => c.heading)).toContain("Service keys");
        // Pinned chunks still lead.
        expect(selected[0].pinned).toBe(true);
    });

    test("never exceeds the requested maximum", () => {
        const selected = selectDocChunks(
            makeChunks(),
            "windows keys setup agents",
            3,
        );
        expect(selected.length).toBeLessThanOrEqual(3);
    });
});

describe("formatDocsGrounding", () => {
    test("labels each excerpt with its source file", () => {
        const text = formatDocsGrounding(makeChunks().slice(0, 2));
        expect(text).toContain("source: index.md");
        expect(text).toContain("It routes natural language");
    });
});

describe("renderHelp", () => {
    test("renders summary, details list, and see-also pointers", () => {
        const response: HelpResponse = {
            summary: "TypeAgent is a personal agent.",
            details: ["It routes requests to agents.", "It keeps memory."],
            seeAlso: [
                { label: "List all commands", command: "help" },
                { label: "List configured agents", command: "config agent" },
            ],
        };
        const blocks = renderHelp(response, undefined);
        expect(blocks[0]).toMatchObject({
            kind: "text",
            text: "TypeAgent is a personal agent.",
        });
        const list = blocks.find((b) => b.kind === "list") as any;
        expect(list.items.map((i: any) => i.text)).toEqual([
            "It routes requests to agents.",
            "It keeps memory.",
        ]);
        const heading = blocks.find((b) => b.kind === "heading") as any;
        expect(heading.text).toBe("See also");
        const pointerList = blocks.filter((b) => b.kind === "list")[1] as any;
        expect(pointerList.items[0].text).toBe("@help");
        expect(pointerList.items[0].subtitle).toBe("List all commands");
    });

    test("falls back to a helpful message when the summary is empty", () => {
        const blocks = renderHelp({ summary: "" }, undefined);
        expect(blocks).toHaveLength(1);
        expect((blocks[0] as any).text).toContain("@help");
    });
});
