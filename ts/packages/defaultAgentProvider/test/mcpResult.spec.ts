// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CallToolResult } from "@modelcontextprotocol/client";
import type {
    ActionResultError,
    ActionResultSuccess,
} from "@typeagent/agent-sdk";
import { convertToolResult } from "../src/mcp/mcpResult.js";

// Build a CallToolResult-shaped object for the pure converter. The converter
// only reads `content`, `isError`, and `structuredContent`.
function result(partial: Partial<CallToolResult>): CallToolResult {
    return { content: [], ...partial } as CallToolResult;
}

describe("convertToolResult", () => {
    it("returns plain text as a success result", () => {
        const r = convertToolResult(
            "read",
            result({ content: [{ type: "text", text: "hello world" }] as any }),
        ) as ActionResultSuccess;
        expect(r.error).toBeUndefined();
        expect(r.historyText).toBe("hello world");
        expect(r.displayContent).toBe("hello world");
    });

    it("joins multiple text blocks with newlines", () => {
        const r = convertToolResult(
            "read",
            result({
                content: [
                    { type: "text", text: "line1" },
                    { type: "text", text: "line2" },
                ] as any,
            }),
        ) as ActionResultSuccess;
        expect(r.historyText).toBe("line1\nline2");
    });

    it("maps isError results to an action error using the tool text", () => {
        const r = convertToolResult(
            "write",
            result({
                isError: true,
                content: [{ type: "text", text: "permission denied" }] as any,
            }),
        ) as ActionResultError;
        expect(r.error).toBe("permission denied");
    });

    it("maps isError with no text to a generic error naming the action", () => {
        const r = convertToolResult(
            "write",
            result({ isError: true, content: [] }),
        ) as ActionResultError;
        expect(r.error).toContain("write");
    });

    it("preserves structuredContent in a markdown display", () => {
        const r = convertToolResult(
            "stat",
            result({
                content: [{ type: "text", text: "ok" }] as any,
                structuredContent: { size: 42, name: "a.txt" },
            }),
        ) as ActionResultSuccess;
        expect(r.historyText).toBe("ok");
        const display = r.displayContent as { type: string; content: string };
        expect(display.type).toBe("markdown");
        expect(display.content).toContain("ok");
        expect(display.content).toContain('"size": 42');
    });

    it("uses serialized structuredContent as history when there is no text", () => {
        const r = convertToolResult(
            "stat",
            result({
                content: [],
                structuredContent: { ok: true },
            }),
        ) as ActionResultSuccess;
        expect(r.historyText).toBe(JSON.stringify({ ok: true }));
        const display = r.displayContent as { type: string; content: string };
        expect(display.type).toBe("markdown");
        expect(display.content).toContain('"ok": true');
    });

    it("renders image content as a data-uri markdown image", () => {
        const r = convertToolResult(
            "screenshot",
            result({
                content: [
                    { type: "text", text: "captured" },
                    { type: "image", data: "QUJD", mimeType: "image/png" },
                ] as any,
            }),
        ) as ActionResultSuccess;
        expect(r.historyText).toBe("captured");
        const display = r.displayContent as { type: string; content: string };
        expect(display.type).toBe("markdown");
        expect(display.content).toContain("captured");
        expect(display.content).toContain(
            "![image](data:image/png;base64,QUJD)",
        );
    });

    it("renders resource_link content as a markdown link", () => {
        const r = convertToolResult(
            "list",
            result({
                content: [
                    {
                        type: "resource_link",
                        name: "notes",
                        uri: "file:///notes.txt",
                    },
                ] as any,
            }),
        ) as ActionResultSuccess;
        const display = r.displayContent as { type: string; content: string };
        expect(display.content).toContain("[notes](file:///notes.txt)");
    });

    it("does not throw on an unknown content type", () => {
        const r = convertToolResult(
            "weird",
            result({
                content: [{ type: "future-block", value: 1 }] as any,
            }),
        ) as ActionResultSuccess;
        const display = r.displayContent as { type: string; content: string };
        expect(display.type).toBe("markdown");
        expect(display.content).toContain("future-block");
    });
});
