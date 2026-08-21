// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Tool } from "@modelcontextprotocol/client";
import type { JsonSchemaValidator } from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import { convertToolsSchema, type SkippedTool } from "./mcpSchema.js";

const maxSchemaBytes = 256 * 1024;
const maxSchemaDepth = 40;
const maxSchemaNodes = 2_000;
const maxCompositionBranches = 128;

export type McpToolIdentity = string;

export function getMcpToolIdentity(
    serverConfigId: string,
    toolName: string,
): McpToolIdentity {
    return JSON.stringify([serverConfigId, toolName]);
}

export interface McpToolCatalogEntry {
    readonly id: McpToolIdentity;
    readonly serverConfigId: string;
    readonly name: string;
    readonly description?: string;
    readonly title?: string;
    readonly icons?: Tool["icons"];
    readonly annotations?: Tool["annotations"];
    readonly inputSchema: Tool["inputSchema"];
    readonly outputSchema?: Tool["outputSchema"];
    readonly validateArguments: JsonSchemaValidator<Record<string, unknown>>;
    readonly validateOutput?: JsonSchemaValidator<unknown>;
}

export interface McpToolCatalog {
    readonly entries: ReadonlyMap<McpToolIdentity, McpToolCatalogEntry>;
    readonly schemaContent: string;
    readonly skipped: readonly SkippedTool[];
    readonly fingerprint: string;
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, child]) => [key, canonicalize(child)]),
        );
    }
    return value;
}

function inspectSchema(schema: unknown, label: string): void {
    let serialized: string;
    try {
        serialized = JSON.stringify(schema);
    } catch (error) {
        throw new Error(
            `${label} is not serializable: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    if (Buffer.byteLength(serialized) > maxSchemaBytes) {
        throw new Error(
            `${label} exceeds the ${maxSchemaBytes}-byte safety limit`,
        );
    }

    let nodes = 0;
    let compositionBranches = 0;
    const visit = (value: unknown, depth: number): void => {
        if (depth > maxSchemaDepth) {
            throw new Error(
                `${label} exceeds the maximum depth of ${maxSchemaDepth}`,
            );
        }
        nodes++;
        if (nodes > maxSchemaNodes) {
            throw new Error(
                `${label} exceeds the maximum node count of ${maxSchemaNodes}`,
            );
        }
        if (value === null || typeof value !== "object") {
            return;
        }
        for (const [key, child] of Object.entries(
            value as Record<string, unknown>,
        )) {
            if (
                key === "$ref" &&
                typeof child === "string" &&
                !child.startsWith("#")
            ) {
                throw new Error(
                    `${label} contains external $ref '${child}'; only local fragment references are allowed`,
                );
            }
            if (
                (key === "allOf" || key === "anyOf" || key === "oneOf") &&
                Array.isArray(child)
            ) {
                compositionBranches += child.length;
                if (compositionBranches > maxCompositionBranches) {
                    throw new Error(
                        `${label} exceeds the composition branch limit of ${maxCompositionBranches}`,
                    );
                }
            }
            visit(child, depth + 1);
        }
    };
    visit(schema, 0);
}

function compileValidator<T>(
    validator: AjvJsonSchemaValidator,
    schema: unknown,
    label: string,
): JsonSchemaValidator<T> {
    inspectSchema(schema, label);
    try {
        return validator.getValidator<T>(schema as Record<string, unknown>);
    } catch (error) {
        throw new Error(
            `${label} is not a supported safe JSON Schema: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}

export function buildMcpToolCatalog(
    serverConfigId: string,
    tools: Tool[],
    entryTypeName: string,
): McpToolCatalog {
    const validator = new AjvJsonSchemaValidator();
    const safeTools: Tool[] = [];
    const validators = new Map<
        string,
        {
            input: JsonSchemaValidator<Record<string, unknown>>;
            output?: JsonSchemaValidator<unknown>;
        }
    >();
    const skipped: SkippedTool[] = [];

    for (const tool of tools) {
        const name = typeof tool?.name === "string" ? tool.name : "(unnamed)";
        const id = getMcpToolIdentity(serverConfigId, name);
        try {
            const input = compileValidator<Record<string, unknown>>(
                validator,
                tool.inputSchema,
                `MCP tool '${name}' inputSchema`,
            );
            const output =
                tool.outputSchema === undefined
                    ? undefined
                    : compileValidator<unknown>(
                          validator,
                          tool.outputSchema,
                          `MCP tool '${name}' outputSchema`,
                      );
            validators.set(id, {
                input,
                ...(output === undefined ? {} : { output }),
            });
            safeTools.push(tool);
        } catch (error) {
            skipped.push({
                id,
                name,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }

    const sortedSafeTools = [...safeTools].sort((a, b) =>
        a.name.localeCompare(b.name),
    );
    const converted = convertToolsSchema(
        sortedSafeTools,
        entryTypeName,
        serverConfigId,
    );
    skipped.push(...converted.skipped);
    const accepted = new Set(converted.accepted);
    const entries = new Map<McpToolIdentity, McpToolCatalogEntry>();
    for (const tool of sortedSafeTools) {
        if (!accepted.has(tool.name)) {
            continue;
        }
        const id = getMcpToolIdentity(serverConfigId, tool.name);
        const compiled = validators.get(id);
        if (compiled === undefined) {
            continue;
        }
        entries.set(
            id,
            Object.freeze({
                id,
                serverConfigId,
                name: tool.name,
                ...(tool.description === undefined
                    ? {}
                    : { description: tool.description }),
                ...(tool.title === undefined ? {} : { title: tool.title }),
                ...(tool.icons === undefined ? {} : { icons: tool.icons }),
                ...(tool.annotations === undefined
                    ? {}
                    : { annotations: tool.annotations }),
                inputSchema: tool.inputSchema,
                ...(tool.outputSchema === undefined
                    ? {}
                    : { outputSchema: tool.outputSchema }),
                validateArguments: compiled.input,
                ...(compiled.output === undefined
                    ? {}
                    : { validateOutput: compiled.output }),
            }),
        );
    }
    const fingerprint = JSON.stringify(
        canonicalize(
            [...entries.values()].map((entry) => ({
                id: entry.id,
                name: entry.name,
                description: entry.description,
                title: entry.title,
                icons: entry.icons,
                annotations: entry.annotations,
                inputSchema: entry.inputSchema,
                outputSchema: entry.outputSchema,
            })),
        ),
    );
    return Object.freeze({
        entries,
        schemaContent: converted.content,
        skipped: Object.freeze(skipped),
        fingerprint,
    });
}
