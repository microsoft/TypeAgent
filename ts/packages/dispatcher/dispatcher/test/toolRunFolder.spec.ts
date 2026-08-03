// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ToolRunFolder,
    formatToolRun,
    formatToolResult,
} from "../src/reasoning/reasoningLoopBase.js";

// Collect the strings the folder emits so each test can assert on the exact
// sequence of rendered tool-call blocks. The injected formatter defaults to the
// identity, so a call's tool name doubles as its display / folding key while its
// arguments vary independently (as real folded calls do).
function makeFolder(
    format: (tool: string, args: unknown) => string = (t) => t,
): { folder: ToolRunFolder; emitted: string[]; errors: boolean[] } {
    const emitted: string[] = [];
    const errors: boolean[] = [];
    const folder = new ToolRunFolder((content, isError) => {
        emitted.push(content);
        errors.push(isError);
    }, format);
    return { folder, emitted, errors };
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

    it("result() emits the buffered call and its result together in one block", () => {
        const { folder, emitted, errors } = makeFolder();
        folder.tool("search", { q: "fruit" });
        expect(emitted).toEqual([]); // buffered until the result arrives
        folder.result("Found 3 matches", false);
        expect(emitted).toHaveLength(1);
        // One emission carries both the call block and the result block.
        expect(emitted[0]).toContain('<details class="reasoning-tool-call">');
        expect(emitted[0]).toContain('<details class="reasoning-tool-result">');
        expect(emitted[0]).toContain("Found 3 matches");
        expect(errors[0]).toBe(false);
    });

    it("result() marks a failed tool as an error emission", () => {
        const { folder, emitted, errors } = makeFolder();
        folder.tool("shell", { cmd: "boom" });
        folder.result("nonzero exit", true);
        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toContain("reasoning-tool-result-error");
        expect(errors[0]).toBe(true);
    });

    it("result() with no buffered call emits just the result", () => {
        const { folder, emitted } = makeFolder();
        folder.result("orphan result", false);
        expect(emitted).toHaveLength(1);
        expect(emitted[0]).not.toContain("reasoning-tool-call");
        expect(emitted[0]).toContain('<details class="reasoning-tool-result">');
    });

    it("keeps the call and result separate when flush() splits them", () => {
        const { folder, emitted } = makeFolder();
        folder.tool("A", {});
        folder.flush(); // e.g. a thinking block interrupts before the result
        folder.result("late", false);
        expect(emitted).toHaveLength(2);
        expect(emitted[0]).toContain("reasoning-tool-call");
        expect(emitted[0]).not.toContain("reasoning-tool-result");
        expect(emitted[1]).toContain("reasoning-tool-result");
        expect(emitted[1]).not.toContain("reasoning-tool-call");
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

describe("formatToolResult", () => {
    // Pull the summary line and the full body text out of a rendered result
    // block for assertions.
    function parseResult(html: string): { summary: string; body: string } {
        const summary =
            html.match(
                /reasoning-tool-result-summary">([\s\S]*?)<\/summary>/,
            )?.[1] ?? "";
        const body =
            html.match(/reasoning-tool-result-body">([\s\S]*?)<\/pre>/)?.[1] ??
            "";
        return { summary, body };
    }

    it("renders a success result as a collapsed block with a one-line preview and full body", () => {
        const html = formatToolResult("Found 3 matches:\nalpha\nbeta", false);
        expect(html).toContain('<details class="reasoning-tool-result">');
        expect(html).not.toContain("reasoning-tool-result-error");
        expect(html).toContain(
            '<summary class="reasoning-tool-result-summary"><strong>\u21B3</strong>',
        );
        const { summary, body } = parseResult(html);
        // The preview flattens newlines into a single line.
        expect(summary).toContain("<code>Found 3 matches: alpha beta</code>");
        // The body preserves the full text (newlines intact).
        expect(body).toBe("Found 3 matches:\nalpha\nbeta");
    });

    it("marks a failed result with the error class and label", () => {
        const html = formatToolResult("boom", true);
        expect(html).toContain(
            '<details class="reasoning-tool-result reasoning-tool-result-error">',
        );
        expect(html).toContain("<strong>Error:</strong>");
        expect(parseResult(html).body).toBe("boom");
    });

    it("truncates the summary preview but keeps the full body for the viewer", () => {
        const long = "x".repeat(300);
        const html = formatToolResult(long, false);
        const { summary, body } = parseResult(html);
        // Preview is capped (…) so the summary line stays short...
        expect(summary).toContain("\u2026");
        expect(summary.length).toBeLessThan(long.length);
        // ...but the full text is still available in the body.
        expect(body).toBe(long);
    });

    it("HTML-escapes result content so markup cannot break out", () => {
        const html = formatToolResult("<script>alert(1)</script>", false);
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;");
    });

    it("shows (empty) for a blank result", () => {
        const html = formatToolResult("   ", false);
        expect(html).toContain("<code>(empty)</code>");
        expect(parseResult(html).body).toBe("(empty)");
    });
});
