// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type McpServerKind = "agent" | "workspace" | "macros";

export function selectMcpServer(args: readonly string[]): McpServerKind {
    const selectors = ["--workspace", "--macros"].filter((selector) =>
        args.includes(selector),
    );
    if (selectors.length > 1) {
        throw new Error(
            `Conflicting MCP server selectors: ${selectors.join(", ")}`,
        );
    }
    if (args.includes("--workspace")) return "workspace";
    if (args.includes("--macros")) return "macros";
    return "agent";
}
