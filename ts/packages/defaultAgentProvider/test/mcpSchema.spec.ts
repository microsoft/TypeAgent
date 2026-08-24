// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Tool } from "@modelcontextprotocol/client";
import { convertToolsSchema } from "../src/mcp/mcpSchema.js";

const entryTypeName = "AgentActions";

// Build a Tool-shaped object. inputSchema defaults to an empty object schema.
function tool(partial: Partial<Tool> & { name: string }): Tool {
    return {
        inputSchema: { type: "object", properties: {} },
        ...partial,
    } as Tool;
}

describe("convertToolsSchema", () => {
    it("accepts all valid tools", () => {
        const tools = [
            tool({ name: "read", description: "read a file" }),
            tool({ name: "write", description: "write a file" }),
        ];
        const r = convertToolsSchema(tools, entryTypeName);
        expect(r.accepted).toEqual(["read", "write"]);
        expect(r.skipped).toHaveLength(0);
        expect(r.content.length).toBeGreaterThan(0);
    });

    it("skips a tool with an unsupported schema construct but keeps the rest", () => {
        const tools = [
            tool({ name: "good", description: "fine" }),
            tool({
                name: "bad",
                description: "uses a $ref",
                inputSchema: {
                    type: "object",
                    properties: { x: { $ref: "#/definitions/Foo" } },
                } as any,
            }),
        ];
        const r = convertToolsSchema(tools, entryTypeName);
        expect(r.accepted).toEqual(["good"]);
        expect(r.skipped).toHaveLength(1);
        expect(r.skipped[0].name).toBe("bad");
        expect(r.skipped[0].reason).toBeTruthy();
    });

    it("throws when no tool is convertible", () => {
        const tools = [
            tool({
                name: "bad",
                inputSchema: {
                    type: "object",
                    properties: { x: { $ref: "#/definitions/Foo" } },
                } as any,
            }),
        ];
        expect(() => convertToolsSchema(tools, entryTypeName)).toThrow();
    });

    it("folds the tool title into the description", () => {
        const tools = [
            tool({
                name: "read",
                title: "Read File",
                description: "read a file",
            } as any),
        ];
        const r = convertToolsSchema(tools, entryTypeName);
        expect(r.accepted).toEqual(["read"]);
        expect(r.content).toContain("Read File: read a file");
    });

    it("skips a tool whose type name collides with an earlier tool", () => {
        const tools = [
            tool({ name: "get_weather", description: "first" }),
            tool({ name: "get-weather", description: "second" }),
        ];
        const r = convertToolsSchema(tools, entryTypeName);
        expect(r.accepted).toEqual(["get_weather"]);
        expect(r.skipped).toHaveLength(1);
        expect(r.skipped[0].name).toBe("get-weather");
        expect(r.skipped[0].reason).toContain("collides");
    });
});
