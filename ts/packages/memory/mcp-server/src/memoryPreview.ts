// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    getUiCapability,
    registerAppResource,
    registerAppTool,
    RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
    understandingRequestSchema,
    understandingModuleRequestSchema,
} from "@typeagent/memory-client";
import type {
    MemoryService,
    UnderstandingResult,
    UnderstandingModuleResult,
} from "@typeagent/memory-service";
import {
    previewMetaKey,
    previewResourceUri,
    type MemoryPreview,
} from "./previewTypes.js";

function bytes(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
}
function assertBytes(value: unknown, maximum: number): void {
    if (bytes(value) > maximum)
        throw new Error(`Memory preview exceeds ${maximum} byte budget`);
}

export function compactPreview(result: UnderstandingResult): MemoryPreview {
    const preview: MemoryPreview = {
        schemaVersion: 1,
        snapshotId: result.snapshotId,
        corpusId: result.corpusId,
        expiresAt: result.expiresAt,
        title: result.answer?.title ?? "Memory evidence",
        status: result.answer?.status ?? "modulesOnly",
        ...(result.answer ? { summary: result.answer.summary } : {}),
        sections: [],
        unknowns: [],
        warnings: [...result.warnings],
        omittedSections: result.answer?.sections.length ?? 0,
        sources: result.citations.slice(0, 3).map((item, index) => {
            const title =
                item.kind === "source"
                    ? item.source.title
                    : item.kind === "derived"
                      ? "Maintained interpretation"
                      : "User assertion";
            return {
                id: item.id,
                kind: item.kind,
                title:
                    Buffer.byteLength(title, "utf8") <= 240
                        ? title
                        : `Retained source ${index + 1}`,
            };
        }),
        sourceCount: result.citations.length,
        modules: result.modules,
    };
    for (const section of result.answer?.sections ?? []) {
        const proposed = {
            ...preview,
            sections: [...preview.sections, section],
            omittedSections: preview.omittedSections - 1,
        };
        if (bytes({ [previewMetaKey]: proposed }) <= 32 * 1024)
            Object.assign(preview, proposed);
    }
    for (const unknown of result.answer?.unknowns ?? [])
        if (
            bytes({
                [previewMetaKey]: {
                    ...preview,
                    unknowns: [...preview.unknowns, unknown],
                },
            }) <=
            32 * 1024
        )
            preview.unknowns.push(unknown);
    assertBytes({ [previewMetaKey]: preview }, 32 * 1024);
    return preview;
}

export function previewToolResult(
    result: UnderstandingResult,
    html: boolean,
): CallToolResult {
    const preview = compactPreview(result);
    const summary =
        preview.summary?.text ?? "Requested supporting evidence is ready.";
    const essential = {
        schemaVersion: 1,
        status: preview.status,
        title: preview.title,
        summary,
        sourceCount: preview.sourceCount,
        modules: preview.modules.map((item) => ({
            kind: item.kind,
            status: item.status,
        })),
        warnings: preview.warnings,
    };
    let response: CallToolResult = {
        content: [
            {
                type: "text",
                text: `## ${essential.title}\n\n${summary}\n\n${essential.sourceCount} retained references. Use memory_answer for a full Markdown answer.`,
            },
        ],
        structuredContent: { result: essential },
    };
    if (bytes(response) > 8 * 1024) {
        essential.summary =
            "The grounded explanation exceeds the compact text budget. Read the attached preview, or use memory_answer for Markdown.";
        essential.warnings = preview.warnings.length
            ? ["Additional retrieval warnings are available in the preview."]
            : [];
        response = {
            content: [
                {
                    type: "text",
                    text: `## ${essential.title}\n\n${essential.summary}`,
                },
            ],
            structuredContent: { result: { ...essential, omitted: "summary" } },
        };
    }
    assertBytes(response, 8 * 1024);
    if (html) response._meta = { [previewMetaKey]: preview };
    return response;
}

export function compactModule(
    input: UnderstandingModuleResult,
): UnderstandingModuleResult {
    const result = structuredClone(input);
    if (result.timeline && result.timeline.length > 6) {
        result.timeline = result.timeline.slice(0, 6);
        result.status = "partial";
        result.reason = "Compact preview shows the first six supported dates";
    }
    if (result.graph) {
        const graph = result.graph;
        const ids = new Set<string>();
        const edges = graph.edges
            .filter((edge) => {
                const added = new Set([...ids, edge.source, edge.target]);
                if (added.size > 8) return false;
                for (const id of added) ids.add(id);
                return true;
            })
            .slice(0, 10);
        const included = new Set(
            edges.flatMap((edge) => [edge.source, edge.target]),
        );
        const nodes = graph.nodes.filter((node) => included.has(node.id));
        if (
            edges.length < graph.edges.length ||
            nodes.length < graph.nodes.length
        ) {
            result.status = "partial";
            graph.counts.omittedEdges += graph.edges.length - edges.length;
            graph.counts.omittedNodes += graph.nodes.length - nodes.length;
        }
        graph.edges = edges;
        graph.nodes = nodes;
        graph.limits = { maxNodes: 8, maxEdges: 10 };
        if (result.support)
            result.support = result.support.filter((item) =>
                edges.some((edge) => edge.id === item.edgeId),
            );
    }
    return result;
}

export function expansionToolResult(
    input: UnderstandingModuleResult,
): CallToolResult {
    const result = compactModule(input);
    const response: CallToolResult = {
        content: [
            {
                type: "text",
                text: `${result.kind}: ${result.status}${result.reason ? ` — ${result.reason}` : ""}`,
            },
        ],
        structuredContent: {
            result: {
                kind: result.kind,
                status: result.status,
                ...(result.reason ? { reason: result.reason } : {}),
            },
        },
        _meta: { [previewMetaKey]: { module: result } },
    };
    assertBytes(response, 64 * 1024);
    return response;
}

export function registerMemoryPreview(
    server: McpServer,
    service: Pick<MemoryService, "understand" | "understandingModule">,
    supportsHtml?: () => boolean,
): void {
    const ui = { resourceUri: previewResourceUri };
    const safe = async (
        operation: () => Promise<CallToolResult>,
    ): Promise<CallToolResult> => {
        try {
            return await operation();
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    },
                ],
            };
        }
    };
    registerAppTool(
        server,
        "memory_preview",
        {
            description:
                "Compact grounded memory explanation for chat hosts. One indexed document collection only; conversation events and filters are unsupported. Optional timeline/relationships/concepts/sources-only selection avoids a hidden prose model call. No embedded chat or attachments. Text fallback is always available.",
            inputSchema: understandingRequestSchema,
            annotations: { readOnlyHint: true },
            _meta: { ui: { ...ui, visibility: ["model"] } },
        },
        (request) =>
            safe(async () => {
                if (!service.understand)
                    throw new Error("Memory understanding is not supported");
                const result = await service.understand(request);
                const capable = getUiCapability(
                    server.server.getClientCapabilities(),
                );
                return previewToolResult(
                    result,
                    supportsHtml
                        ? supportsHtml()
                        : capable?.mimeTypes?.includes(RESOURCE_MIME_TYPE) ===
                              true,
                );
            }),
    );
    registerAppTool(
        server,
        "memory_preview_expand",
        {
            description:
                "Explicitly expand a bounded module for an existing authorized memory preview. Visibility is not authorization; normal service access and snapshot validation still apply.",
            inputSchema: understandingModuleRequestSchema,
            annotations: { readOnlyHint: true },
            _meta: { ui: { ...ui, visibility: ["app"] } },
        },
        (request) =>
            safe(async () => {
                if (!service.understandingModule)
                    throw new Error(
                        "Memory understanding modules are not supported",
                    );
                return expansionToolResult(
                    await service.understandingModule(request),
                );
            }),
    );
    registerAppResource(
        server,
        "Memory preview",
        previewResourceUri,
        {
            description:
                "Compact, versioned memory renderer. No network access or embedded composer.",
            _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
        },
        async () => {
            const text = await readFile(
                new URL("./preview.html", import.meta.url),
                "utf8",
            );
            if (Buffer.byteLength(text, "utf8") > 400 * 1024)
                throw new Error("Memory renderer exceeds 400 KiB");
            return {
                contents: [
                    {
                        uri: previewResourceUri,
                        mimeType: RESOURCE_MIME_TYPE,
                        text,
                        _meta: {
                            ui: {
                                csp: {
                                    connectDomains: [],
                                    resourceDomains: [],
                                },
                            },
                        },
                    },
                ],
            };
        },
    );
}
