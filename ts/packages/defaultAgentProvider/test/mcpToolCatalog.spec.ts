// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Tool } from "@modelcontextprotocol/client";
import {
    buildMcpToolCatalog,
    getMcpToolIdentity,
} from "../src/mcp/mcpToolCatalog.js";

function tool(
    name: string,
    inputSchema: Tool["inputSchema"] = {
        type: "object",
        properties: {},
    },
    outputSchema?: Tool["outputSchema"],
): Tool {
    return {
        name,
        inputSchema,
        ...(outputSchema === undefined ? {} : { outputSchema }),
    };
}

describe("MCP tool catalog safety", () => {
    it("uses server config id and tool name as durable identity", () => {
        const a = buildMcpToolCatalog("server-a", [tool("search")], "Actions");
        const b = buildMcpToolCatalog("server-b", [tool("search")], "Actions");

        expect([...a.entries.keys()]).toEqual([
            getMcpToolIdentity("server-a", "search"),
        ]);
        expect([...b.entries.keys()]).toEqual([
            getMcpToolIdentity("server-b", "search"),
        ]);
        expect([...a.entries.keys()]).not.toEqual([...b.entries.keys()]);
    });

    it("produces a stable fingerprint when server ordering changes", () => {
        const forward = buildMcpToolCatalog(
            "server",
            [tool("alpha"), tool("beta")],
            "Actions",
        );
        const reverse = buildMcpToolCatalog(
            "server",
            [tool("beta"), tool("alpha")],
            "Actions",
        );

        expect(reverse.fingerprint).toBe(forward.fingerprint);
        expect(reverse.schemaContent).toBe(forward.schemaContent);
    });

    it("skips external refs and excessive complexity per tool", () => {
        const deep: Record<string, unknown> = { type: "object" };
        let cursor = deep;
        for (let i = 0; i < 45; i++) {
            const next: Record<string, unknown> = { type: "object" };
            cursor.properties = { child: next };
            cursor = next;
        }
        const catalog = buildMcpToolCatalog(
            "server",
            [
                tool("good"),
                tool("external", {
                    type: "object",
                    properties: {
                        value: { $ref: "https://example.com/schema.json" },
                    },
                } as Tool["inputSchema"]),
                tool("deep", deep as Tool["inputSchema"]),
                tool("composed", {
                    type: "object",
                    oneOf: Array.from({ length: 129 }, () => ({
                        type: "object",
                    })),
                } as Tool["inputSchema"]),
            ],
            "Actions",
        );

        expect(
            [...catalog.entries.values()].map((entry) => entry.name),
        ).toEqual(["good"]);
        expect(catalog.skipped).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: getMcpToolIdentity("server", "external"),
                    reason: expect.stringContaining("external $ref"),
                }),
                expect.objectContaining({
                    id: getMcpToolIdentity("server", "deep"),
                    reason: expect.stringContaining("maximum depth"),
                }),
                expect.objectContaining({
                    id: getMcpToolIdentity("server", "composed"),
                    reason: expect.stringContaining("composition branch limit"),
                }),
            ]),
        );
    });

    it("honors declared dialects and validates arguments and output", () => {
        const catalog = buildMcpToolCatalog(
            "server",
            [
                tool(
                    "typed",
                    {
                        $schema: "http://json-schema.org/draft-07/schema#",
                        type: "object",
                        required: ["count"],
                        properties: { count: { type: "integer" } },
                    } as Tool["inputSchema"],
                    {
                        $schema: "https://json-schema.org/draft/2020-12/schema",
                        type: "object",
                        required: ["ok"],
                        properties: { ok: { type: "boolean" } },
                    },
                ),
            ],
            "Actions",
        );
        const entry = catalog.entries.get(
            getMcpToolIdentity("server", "typed"),
        )!;

        expect(entry.validateArguments({ count: 2 }).valid).toBe(true);
        expect(entry.validateArguments({ count: "2" }).valid).toBe(false);
        expect(entry.validateOutput?.({ ok: true }).valid).toBe(true);
        expect(entry.validateOutput?.({ ok: "yes" }).valid).toBe(false);
    });

    it("preserves tool metadata in the internal catalog", () => {
        const source = {
            ...tool("rich"),
            title: "Rich tool",
            description: "Does useful work",
            annotations: { readOnlyHint: true },
            icons: [{ src: "data:image/png;base64,AA==" }],
            outputSchema: { type: "object", properties: {} },
        } as Tool;
        const catalog = buildMcpToolCatalog("server", [source], "Actions");
        const entry = catalog.entries.get(getMcpToolIdentity("server", "rich"));

        expect(entry).toMatchObject({
            title: "Rich tool",
            description: "Does useful work",
            annotations: { readOnlyHint: true },
            icons: [{ src: "data:image/png;base64,AA==" }],
            outputSchema: source.outputSchema,
        });
    });
});
