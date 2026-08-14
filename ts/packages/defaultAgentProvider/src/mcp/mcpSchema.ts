// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Tool } from "@modelcontextprotocol/client";
import {
    parseToolsJsonSchema,
    toJSONParsedActionSchema,
    toPascalCase,
} from "@typeagent/action-schema";
import registerDebug from "debug";

const debug = registerDebug("typeagent:mcp:schema");

// A tool that was excluded from the generated action schema, with a
// human-readable reason (unsupported JSON Schema construct, name collision,
// etc.). Surfaced as a diagnostic so one problematic tool does not silently
// disappear or take the whole server down with it.
export type SkippedTool = { id: string; name: string; reason: string };

export type ConvertToolsResult = {
    // Serialized JSONParsedActionSchema for the accepted tools.
    content: string;
    // Names of the tools included in the schema.
    accepted: string[];
    // Tools excluded from the schema, with the reason.
    skipped: SkippedTool[];
};

// The subset of an MCP tool the action-schema parser understands.
type ParserTool = {
    name: string;
    description?: string;
    inputSchema: unknown;
};

// Fold an MCP tool's human-friendly `title` into the description the model
// sees, so both the display name and the behavioral description reach the LLM.
function effectiveDescription(tool: Tool): string | undefined {
    const anyTool = tool as { title?: unknown; description?: unknown };
    const title = typeof anyTool.title === "string" ? anyTool.title : undefined;
    const description =
        typeof anyTool.description === "string"
            ? anyTool.description
            : undefined;
    if (title !== undefined && description !== undefined) {
        return `${title}: ${description}`;
    }
    return title ?? description;
}

function toParserTool(tool: Tool): ParserTool {
    const description = effectiveDescription(tool);
    const parserTool: ParserTool = {
        name: tool.name,
        inputSchema: tool.inputSchema,
    };
    if (description !== undefined) {
        parserTool.description = description;
    }
    return parserTool;
}

// Convert a server's tool list into an action schema, tolerating individual
// tools the parser cannot represent. Each tool is probed on its own; ones that
// throw (unsupported constructs such as `$ref`/`null`, or a generated-type-name
// collision) are recorded in `skipped` and left out instead of failing the
// entire server. Throws only when NO tool is convertible.
export function convertToolsSchema(
    tools: Tool[],
    entryTypeName: string,
    serverConfigId = "",
): ConvertToolsResult {
    const accepted: string[] = [];
    const acceptedTools: ParserTool[] = [];
    const skipped: SkippedTool[] = [];
    const seenTypeNames = new Map<string, string>();

    for (const tool of tools) {
        const name = typeof tool?.name === "string" ? tool.name : "(unnamed)";
        const id = JSON.stringify([serverConfigId, name]);

        // Two distinct tool names can collapse to the same PascalCase type
        // name (e.g. "get_weather" and "get-weather"); keep the first and skip
        // the rest so the combined parse does not fail on a duplicate type.
        const typeName = toPascalCase(name);
        const collidesWith = seenTypeNames.get(typeName);
        if (collidesWith !== undefined) {
            const reason = `type name '${typeName}' collides with tool '${collidesWith}'`;
            skipped.push({ id, name, reason });
            debug(`skipping tool '${name}': ${reason}`);
            continue;
        }

        const parserTool = toParserTool(tool);
        try {
            // Probe: parsing this single tool surfaces any unsupported schema
            // construct as a throw before it can poison the combined parse.
            parseToolsJsonSchema([parserTool], entryTypeName);
        } catch (e: any) {
            const reason = e?.message ?? String(e);
            skipped.push({ id, name, reason });
            debug(`skipping tool '${name}': ${reason}`);
            continue;
        }

        seenTypeNames.set(typeName, name);
        acceptedTools.push(parserTool);
        accepted.push(name);
    }

    if (acceptedTools.length === 0) {
        const detail = skipped.map((s) => `${s.name} (${s.reason})`).join("; ");
        throw new Error(
            `No convertible tools out of ${tools.length} (${detail})`,
        );
    }

    const pas = parseToolsJsonSchema(acceptedTools, entryTypeName);
    return {
        content: JSON.stringify(toJSONParsedActionSchema(pas)),
        accepted,
        skipped,
    };
}
