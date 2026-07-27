// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ToolRunFolder,
    formatToolRun,
} from "../src/reasoning/reasoningLoopBase.js";

// Collect the strings the folder emits so each test can assert on the exact
// sequence of rendered tool-call blocks. The injected formatter defaults to the
// identity, so a call's tool name doubles as its display / folding key while its
// arguments vary independently (as real folded calls do).
function makeFolder(
    format: (tool: string, args: unknown) => string = (t) => t,
): { folder: ToolRunFolder; emitted: string[] } {
    const emitted: string[] = [];
    const folder = new ToolRunFolder(
        (content) => emitted.push(content),
        format,
    );
    return { folder, emitted };
}

// Every tool call (single or folded) renders as a native
// <details class="reasoning-tool-call"> with a <summary> and a <pre> holding that
// call's own JSON (an object for one call, an array for a folded run). Parse both
// out for assertions.
function parseToolRun(content: string): {
    summary: string;
    json: unknown;
    tools: string[];
} {
    expect(content).toContain('<details class="reasoning-tool-call">');
    expect(content).toContain('<summary class="reasoning-tool-call-summary">');
    expect(content).toContain(
        '<pre class="chat-json reasoning-tool-call-json">',
    );
    const summary =
        content.match(
            /reasoning-tool-call-summary">([\s\S]*?)<\/summary>/,
        )?.[1] ?? "";
    const raw =
        content.match(/reasoning-tool-call-json">([\s\S]*?)<\/pre>/)?.[1] ?? "";
    const json = JSON.parse(
        raw.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"),
    );
    const tools = Array.isArray(json)
        ? json.map((t: { tool: string }) => t.tool)
        : [(json as { tool: string }).tool];
    return { summary, json, tools };
}

function expectRun(content: string, summary: string, tools: string[]): void {
    const parsed = parseToolRun(content);
    expect(parsed.summary).toContain(summary);
    expect(parsed.tools).toEqual(tools);
}

describe("ToolRunFolder", () => {
    it("emits a single tool call as its own click-to-expand block (no xN)", () => {
        const { folder, emitted } = makeFolder();
        folder.tool("A", { offset: 0 });
        expect(emitted).toEqual([]); // buffered until flushed
        folder.flush();
        expect(emitted).toHaveLength(1);
        expectRun(emitted[0], "A", ["A"]);
        // A single call's JSON is a lone object (not an array).
        expect(parseToolRun(emitted[0]).json).toEqual({
            tool: "A",
            arguments: { offset: 0 },
        });
    });

    it("folds identical adjacent calls (differing args) into one xN block", () => {
        const { folder, emitted } = makeFolder();
        folder.tool("A", { offset: 0 });
        folder.tool("A", { offset: 6 });
        folder.tool("A", { offset: 12 });
        folder.flush();
        expect(emitted).toHaveLength(1);
        expectRun(emitted[0], "A x3", ["A", "A", "A"]);
        // A folded run's JSON is an array preserving each call's own arguments.
        const json = parseToolRun(emitted[0]).json as {
            arguments: { offset: number };
        }[];
        expect(json.map((e) => e.arguments.offset)).toEqual([0, 6, 12]);
    });

    it("keeps duplicate calls separate when a different call splits them", () => {
        const { folder, emitted } = makeFolder();
        folder.tool("A", {});
        folder.tool("B", {});
        folder.tool("A", {});
        folder.flush();
        // No adjacent identical pair → three separate single blocks.
        expect(emitted).toHaveLength(3);
        expectRun(emitted[0], "A", ["A"]);
        expectRun(emitted[1], "B", ["B"]);
        expectRun(emitted[2], "A", ["A"]);
    });

    it("does not merge across a flush (e.g. a thinking block between runs)", () => {
        const { folder, emitted } = makeFolder();
        folder.tool("A", {});
        folder.flush(); // interrupted by a non-tool display
        folder.tool("A", {});
        folder.flush();
        expect(emitted).toHaveLength(2);
        expectRun(emitted[0], "A", ["A"]);
        expectRun(emitted[1], "A", ["A"]);
    });

    it("folds multiple distinct runs independently", () => {
        const { folder, emitted } = makeFolder();
        folder.tool("A", {});
        folder.tool("A", {});
        folder.tool("B", {});
        folder.tool("B", {});
        folder.tool("B", {});
        folder.flush();
        expect(emitted).toHaveLength(2);
        expectRun(emitted[0], "A x2", ["A", "A"]);
        expectRun(emitted[1], "B x3", ["B", "B", "B"]);
    });

    it("emits the prior run immediately when a different call starts", () => {
        const { folder, emitted } = makeFolder();
        folder.tool("A", {});
        folder.tool("A", {});
        // Switching tools flushes the buffered run without an explicit flush().
        folder.tool("B", {});
        expect(emitted).toHaveLength(1);
        expectRun(emitted[0], "A x2", ["A", "A"]);
        folder.flush();
        expect(emitted).toHaveLength(2);
        expectRun(emitted[1], "B", ["B"]); // single call → no xN
    });

    it("folds by display line, so different args do not split a run", () => {
        // A formatter coarser than the raw args (only the tool name) is what
        // makes read_conversation-style paging fold despite varying offsets.
        const { folder, emitted } = makeFolder((tool) => `**Tool:** ${tool}`);
        folder.tool("read", { offset: 0 });
        folder.tool("read", { offset: 6 });
        folder.flush();
        expect(emitted).toHaveLength(1);
        // The summary carries the display line with its markdown converted to
        // HTML (**Tool:** -> <strong>Tool:</strong>).
        expectRun(emitted[0], "<strong>Tool:</strong> read x2", [
            "read",
            "read",
        ]);
    });

    it("treats flush with nothing pending as a no-op", () => {
        const { folder, emitted } = makeFolder();
        folder.flush();
        folder.flush();
        expect(emitted).toEqual([]);
    });

    it("resets the count and buffered details after each flushed run", () => {
        const { folder, emitted } = makeFolder();
        folder.tool("A", {});
        folder.tool("A", {});
        folder.flush();
        folder.tool("A", {});
        folder.flush();
        expect(emitted).toHaveLength(2);
        expectRun(emitted[0], "A x2", ["A", "A"]);
        expectRun(emitted[1], "A", ["A"]); // second run is a single call
    });
});

describe("formatToolRun", () => {
    it("renders a single call as a click-to-expand block with its own object JSON", () => {
        const html = formatToolRun("**Tool:** `get_conversation_info`", [
            { tool: "get_conversation_info", args: { limit: 1 } },
        ]);
        expect(html).toContain('<details class="reasoning-tool-call">');
        // Tool name becomes inline <code> (highlighted chip); no "xN" for one call.
        expect(html).toContain(
            '<summary class="reasoning-tool-call-summary"><strong>Tool:</strong>',
        );
        expect(html).toContain("<code>get_conversation_info</code>");
        expect(html).not.toContain(" x1");
        expect(html).toContain(
            '<pre class="chat-json reasoning-tool-call-json">',
        );
        // Only the relevant JSON for this one call — a lone object.
        expect(parseToolRun(html).json).toEqual({
            tool: "get_conversation_info",
            arguments: { limit: 1 },
        });
    });

    it("renders a folded run's JSON as an array of the calls", () => {
        const html = formatToolRun("**Tool:** `read_conversation` x2", [
            { tool: "read_conversation", args: { offset: 0 } },
            { tool: "read_conversation", args: { offset: 6 } },
        ]);
        expect(html).toContain("<code>read_conversation</code> x2");
        expect(parseToolRun(html).json).toEqual([
            { tool: "read_conversation", arguments: { offset: 0 } },
            { tool: "read_conversation", arguments: { offset: 6 } },
        ]);
    });

    it("HTML-escapes argument values so markup in args cannot break out", () => {
        const html = formatToolRun("**Tool:** `shell`", [
            { tool: "shell", args: { command: "<script>alert(1)</script>" } },
        ]);
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;");
    });
});
