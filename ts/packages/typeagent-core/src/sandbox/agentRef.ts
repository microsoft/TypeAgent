// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Resolve an agent reference (a bare name, a path under a configured agent
 * root, a conventional `packages/agents/<name>` path, or an arbitrary
 * directory/file path) to the agent's package name.
 *
 * When the configured {@link agentRoots} are supplied, a reference that sits
 * under one of them resolves to the first path segment after that root — so the
 * name is correct for any configured source, not just the default monorepo
 * layout. The hard-coded `packages/agents/` marker is only a fallback for
 * references that don't match a known root (e.g. a path captured before roots
 * were configured); a bare name passes through unchanged.
 */
export function resolveAgentName(
    agentRef: string,
    agentRoots?: readonly string[],
): string {
    let normalized = agentRef.replace(/\\/g, "/");
    while (normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
    }

    // Prefer deriving the name relative to a configured agent root: the first
    // segment after the root is the agent's package dir. Try the longest (most
    // specific) matching root so nested roots resolve correctly.
    if (agentRoots && agentRoots.length > 0) {
        const roots = [...agentRoots]
            .map((r) => r.replace(/\\/g, "/").replace(/\/+$/, ""))
            .filter((r) => r.length > 0)
            .sort((a, b) => b.length - a.length);
        for (const root of roots) {
            const prefix = `${root}/`;
            if (normalized.startsWith(prefix)) {
                const name = normalized.slice(prefix.length).split("/")[0];
                if (name) {
                    return name;
                }
            }
        }
    }

    // Fallback for the conventional monorepo layout when no configured root
    // matched.
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
