// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type McpServerKind = "agent" | "workspace" | "macros" | "skills";

export function selectMcpServer(args: readonly string[]): McpServerKind {
    const selectors = ["--workspace", "--macros", "--skills"].filter(
        (selector) => args.includes(selector),
    );
    if (selectors.length > 1) {
        throw new Error(
            `Conflicting MCP server selectors: ${selectors.join(", ")}`,
        );
    }
    if (args.includes("--workspace")) return "workspace";
    if (args.includes("--macros")) return "macros";
    if (args.includes("--skills")) return "skills";
    return "agent";
}
