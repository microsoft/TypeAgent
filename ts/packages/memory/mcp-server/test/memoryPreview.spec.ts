// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
    RESOURCE_MIME_TYPE,
    EXTENSION_ID,
} from "@modelcontextprotocol/ext-apps/server";
import {
    compactModule,
    compactPreview,
    expansionToolResult,
    previewToolResult,
    registerMemoryPreview,
} from "../src/memoryPreview.js";
import { previewMetaKey, previewResourceUri } from "../src/previewTypes.js";
import { registerUnderstandingTools } from "../src/understandingTools.js";
import { observeMemoryUiCapability } from "../src/memoryUiCapability.js";
import {
    understandingToolNames,
    understandingResultSchema,
    understandingModuleResultSchema,
} from "@typeagent/memory-client";
import type {
    MemoryService,
    UnderstandingResult,
    UnderstandingModuleResult,
} from "@typeagent/memory-service";
import type {
    CallToolResult,
    ClientCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

function answer(): UnderstandingResult {
    return {
        schemaVersion: 1,
        corpusId: "corpus",
        question: "How did the gallery change?",
        snapshotId: "11111111-1111-4111-8111-111111111111",
        turnId: "22222222-2222-4222-8222-222222222222",
        expiresAt: "2099-01-01T00:00:00.000Z",
        answer: {
            status: "partial",
            title: "Gallery change",
            summary: {
                text: "The user reported six projects.",
                evidenceIds: ["s0"],
                role: "memory",
            },
            sections: [],
            unknowns: ["Intermediate changes are unknown."],
            followUps: ["Was it verified?"],
        },
        citations: [
            {
                id: "s0",
                kind: "source",
                source: {
                    evidenceId: "fragment",
                    corpusId: "corpus",
                    sourceId: "source",
                    revisionId: "revision",
                    title: "Gallery report",
                    snippet: "Six projects.",
                    score: 1,
                    sourceType: "text",
                    indexedAt: "2024-03-15T00:00:00.000Z",
                },
            },
        ],
        modules: [{ kind: "sources", status: "ready" }],
        warnings: ["Source-only retrieval; maintained views were unavailable."],
    };
}
function moduleResult(): UnderstandingModuleResult {
    return {
        schemaVersion: 1,
        corpusId: "corpus",
        snapshotId: answer().snapshotId,
        kind: "sources",
        status: "ready",
        citations: answer().citations,
    };
}
function serializedBytes(value: unknown) {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
}

describe("compact payload admission", () => {
    test("keeps ready source references, warnings and no composer/follow-up history", () => {
        const preview = compactPreview(answer());
        expect(preview.sources).toHaveLength(1);
        expect(preview.warnings).toHaveLength(1);
        expect(preview).not.toHaveProperty("followUps");
        expect(preview).not.toHaveProperty("parentTurnId");
    });
    test("bounds model-visible wrapper and UI metadata separately for maximum multibyte claims", () => {
        const value = answer();
        if (!value.answer) throw new Error("Missing fixture answer");
        value.answer.summary.text = "\u4e2d".repeat(3000);
        value.answer.sections = Array.from({ length: 4 }, (_, index) => ({
            title: `Section ${index}`,
            claims: [
                {
                    text: "\u4e2d".repeat(3000),
                    evidenceIds: ["s0"],
                    role: "memory",
                },
            ],
        }));
        const result = previewToolResult(value, true);
        const { _meta, ...model } = result;
        expect(serializedBytes(model)).toBeLessThanOrEqual(8 * 1024);
        expect(serializedBytes(_meta)).toBeLessThanOrEqual(32 * 1024);
        expect(result.structuredContent?.result).toMatchObject({
            omitted: "summary",
        });
        const preview = compactPreview(value);
        expect(preview.omittedSections).toBeGreaterThan(0);
        expect(
            preview.sections.every(
                (section) => section.claims[0].text.length === 3000,
            ),
        ).toBe(true);
    });
    test("plain hosts get useful Markdown without UI metadata", () => {
        const result = previewToolResult(answer(), false);
        expect(result).not.toHaveProperty("_meta");
        expect(result.content).toContainEqual({
            type: "text",
            text: expect.stringContaining("six projects"),
        });
        expect(result.structuredContent?.result).toMatchObject({
            warnings: expect.any(Array),
        });
    });
    test("caps dates in the actual expansion payload, not just the rendered rows", () => {
        const value = moduleResult();
        value.kind = "timeline";
        value.timeline = Array.from({ length: 16 }, (_, index) => ({
            id: `d${index}`,
            evidenceId: "s0",
            date: `2024-03-${String(index + 1).padStart(2, "0")}`,
            precision: "day",
            kind: "sourceSession",
            label: "Session context",
        }));
        const result = compactModule(value);
        expect(result.timeline).toHaveLength(6);
        expect(result.status).toBe("partial");
        expect(value.timeline).toHaveLength(16);
        expect(serializedBytes(expansionToolResult(value))).toBeLessThanOrEqual(
            64 * 1024,
        );
    });
    test("caps actual graph nodes/edges and their support without dangling endpoints", () => {
        const value = moduleResult();
        value.kind = "relationships";
        value.graph = {
            corpusId: "corpus",
            generation: "g1",
            state: "ready",
            nodes: Array.from({ length: 12 }, (_, index) => ({
                id: `n${index}`,
                kind: "entity",
                label: `Entity ${index}`,
                types: [],
                mentionCount: 1,
                supportCount: 1,
            })),
            edges: Array.from({ length: 16 }, (_, index) => ({
                id: `e${index}`,
                source: "n0",
                target: `n${(index % 11) + 1}`,
                type: "recorded",
                count: 1,
                supportCount: 1,
            })),
            counts: { nodes: 12, edges: 16, omittedNodes: 0, omittedEdges: 0 },
            limits: { maxNodes: 12, maxEdges: 16 },
            coverage: {
                documents: {
                    state: "ready",
                    total: 1,
                    eligible: 1,
                    indexed: 1,
                },
                events: {
                    state: "unsupported",
                    total: 0,
                    eligible: 0,
                    indexed: 0,
                },
                reasons: [],
            },
        };
        value.support = value.graph.edges.map((edge) => ({
            edgeId: edge.id,
            items: [
                {
                    kind: "document",
                    corpusId: "corpus",
                    sourceId: "source",
                    revisionId: "revision",
                },
            ],
        }));
        const result = compactModule(value);
        const graph = result.graph!;
        expect(graph.nodes.length).toBeLessThanOrEqual(8);
        expect(graph.edges.length).toBeLessThanOrEqual(10);
        expect(
            graph.edges.every(
                (edge) =>
                    graph.nodes.some((node) => node.id === edge.source) &&
                    graph.nodes.some((node) => node.id === edge.target),
            ),
        ).toBe(true);
        expect(
            result.support?.every((item) =>
                graph.edges.some((edge) => edge.id === item.edgeId),
            ),
        ).toBe(true);
    });
});

describe("real in-memory MCP registration and negotiation", () => {
    let server: McpServer;
    let client: Client;
    let calls: number;
    async function connect(html: boolean) {
        calls = 0;
        server = new McpServer({ name: "memory-preview-test", version: "1" });
        const service: Pick<
            MemoryService,
            "understand" | "understandingModule"
        > = {
            understand: async () => {
                calls++;
                return answer();
            },
            understandingModule: async () => moduleResult(),
        };
        let supportsUi = () => false;
        registerMemoryPreview(server, service, () => supportsUi());
        registerUnderstandingTools(
            server,
            service,
            async (operation): Promise<CallToolResult> => {
                try {
                    const result = await operation();
                    return {
                        content: [
                            { type: "text", text: JSON.stringify(result) },
                        ],
                        structuredContent: { result },
                    };
                } catch (error) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: String(error) }],
                    };
                }
            },
        );
        const capabilities: ClientCapabilities & {
            extensions?: Record<string, { mimeTypes: string[] }>;
        } = html
            ? {
                  extensions: {
                      [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] },
                  },
              }
            : {};
        client = new Client(
            { name: "preview-host", version: "1" },
            {
                capabilities,
            },
        );
        const [left, right] = InMemoryTransport.createLinkedPair();
        await server.connect(right);
        supportsUi = observeMemoryUiCapability(right);
        await client.connect(left);
    }
    afterEach(async () => {
        await client?.close();
        await server?.close();
    });
    test.each([true, false])(
        "negotiates HTML=%s without changing native service envelope",
        async (html) => {
            await connect(html);
            const result = await client.callTool({
                name: "memory_preview",
                arguments: { corpusId: "corpus", question: "gallery" },
            });
            expect(!!result._meta?.[previewMetaKey]).toBe(html);
            const native = await client.callTool({
                name: understandingToolNames.understand,
                arguments: { corpusId: "corpus", question: "gallery" },
            });
            expect(native).not.toHaveProperty("_meta");
            expect(
                z
                    .object({ result: understandingResultSchema })
                    .parse(native.structuredContent).result,
            ).toMatchObject({ snapshotId: answer().snapshotId });
            const module = await client.callTool({
                name: understandingToolNames.module,
                arguments: {
                    corpusId: "corpus",
                    snapshotId: answer().snapshotId,
                    kind: "sources",
                },
            });
            expect(
                z
                    .object({ result: understandingModuleResultSchema })
                    .parse(module.structuredContent).result.status,
            ).toBe("ready");
            expect(calls).toBe(2);
        },
    );
    test("publishes app-only expansion metadata and a bounded packaged CSP resource", async () => {
        await connect(true);
        const tools = await client.listTools();
        expect(
            tools.tools.find((item) => item.name === "memory_preview_expand")
                ?._meta?.ui,
        ).toMatchObject({ visibility: ["app"] });
        const resource = await client.readResource({ uri: previewResourceUri });
        const content = resource.contents[0];
        if (!("text" in content) || typeof content.text !== "string")
            throw new Error("Missing packaged renderer");
        expect(content.mimeType).toBe(RESOURCE_MIME_TYPE);
        expect(Buffer.byteLength(content.text, "utf8")).toBeLessThanOrEqual(
            400 * 1024,
        );
        expect(content.text).toContain("default-src 'none'");
        expect(content.text).toContain("script-src 'sha256-");
        const policy = content.text.match(
            /Content-Security-Policy" content="([^"]+)"/,
        )?.[1];
        expect(policy).not.toContain("unsafe-eval");
        expect(content.text).not.toContain("https://cdn.");
    });
    test("runtime schemas reject scope broadening, arbitrary HTML and unknown module arguments", async () => {
        await connect(true);
        const bad = await client.callTool({
            name: "memory_preview",
            arguments: {
                corpusId: "corpus",
                question: "gallery",
                html: "<script/>",
            },
        });
        expect(bad.isError).toBe(true);
        expect(calls).toBe(0);
    });
});
