// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Resolve an agent reference (a bare name, a `packages/agents/<name>` path, or
 * an arbitrary directory/file path) to the agent's package name.
 */
export function resolveAgentName(agentRef: string): string {
    let normalized = agentRef.replace(/\\/g, "/");
    while (normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
    }
    const marker = "packages/agents/";
    const markerAt = normalized.lastIndexOf(marker);
    if (markerAt >= 0) {
        const rest = normalized.slice(markerAt + marker.length);
        const name = rest.split("/")[0];
        if (name) {
            return name;
        }
    }
    const tail = normalized.split("/").pop() ?? agentRef;
    return tail.replace(/\.[^.]+$/, "") || agentRef;
}
