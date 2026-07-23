// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BenchmarkAgentConfig } from "./types.js";

export async function loadBenchmarkAgent(
    fileName: string,
): Promise<BenchmarkAgentConfig> {
    const file = path.resolve(fileName);
    return parseBenchmarkAgent(await readFile(file, "utf8"), file);
}

export function parseBenchmarkAgent(
    source: string,
    fileName: string,
): BenchmarkAgentConfig {
    const normalized = source.replaceAll("\r\n", "\n");
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(normalized);
    if (!match) {
        throw new Error(`Agent ${fileName} must contain YAML frontmatter`);
    }
    const fields = new Map<string, string>();
    for (const rawLine of match[1].split("\n")) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        const colon = line.indexOf(":");
        if (colon <= 0) {
            throw new Error(`Invalid agent frontmatter line: ${rawLine}`);
        }
        const key = line.slice(0, colon).trim();
        if (!["name", "description", "tools"].includes(key)) {
            throw new Error(`Unsupported agent frontmatter field: ${key}`);
        }
        if (fields.has(key)) {
            throw new Error(`Duplicate agent frontmatter field: ${key}`);
        }
        fields.set(key, line.slice(colon + 1).trim());
    }

    const name = parseScalar(fields.get("name"), "name");
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
        throw new Error("Agent name must be lowercase kebab-case");
    }
    const description = parseScalar(fields.get("description"), "description");
    const tools = parseTools(fields.get("tools"));
    const prompt = match[2].trim();
    if (!prompt) {
        throw new Error("Agent prompt must not be empty");
    }
    return {
        name,
        description,
        tools,
        prompt,
        file: path.resolve(fileName),
        sha256: createHash("sha256").update(source).digest("hex"),
    };
}

function parseScalar(value: string | undefined, field: string): string {
    if (!value) {
        throw new Error(`Agent frontmatter requires ${field}`);
    }
    let parsed = value;
    if (value.startsWith('"')) {
        try {
            parsed = JSON.parse(value) as string;
        } catch {
            throw new Error(`Agent ${field} must be a valid string`);
        }
    }
    if (!parsed.trim()) {
        throw new Error(`Agent ${field} must not be empty`);
    }
    return parsed.trim();
}

function parseTools(value: string | undefined): string[] {
    if (!value) {
        throw new Error("Agent frontmatter requires tools");
    }
    let tools: unknown;
    try {
        tools = JSON.parse(value);
    } catch {
        throw new Error("Agent tools must use a JSON string array");
    }
    if (
        !Array.isArray(tools) ||
        tools.length === 0 ||
        tools.some((tool) => typeof tool !== "string" || !tool.trim())
    ) {
        throw new Error("Agent tools must be a non-empty string array");
    }
    const normalized = tools.map((tool) => tool.trim());
    if (new Set(normalized).size !== normalized.length) {
        throw new Error("Agent tools must be unique");
    }
    return normalized;
}
