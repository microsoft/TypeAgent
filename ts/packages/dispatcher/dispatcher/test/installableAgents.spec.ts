// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    findInstallableAgents,
    formatInstallableAgents,
} from "../src/reasoning/installableAgents.js";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";
import type {
    AppAgentSource,
    InstallableAgentSummary,
} from "../src/agentProvider/agentProvider.js";

function summary(
    installName: string,
    source: string,
    description?: string,
): InstallableAgentSummary {
    return {
        installName,
        packageName: `@typeagent/${installName}-agent`,
        ...(description !== undefined ? { description } : {}),
        source,
        installCommand: `@package install ${installName}`,
    };
}

// Build a minimal CommandHandlerContext exposing only the two fields the helper
// reads: the injected sources and the installed schema names.
function fakeContext(
    sources: AppAgentSource[],
    installedSchemas: string[] = [],
): CommandHandlerContext {
    return {
        appAgentSources: sources,
        agents: { getSchemaNames: () => installedSchemas },
    } as unknown as CommandHandlerContext;
}

function sourceReturning(agents: InstallableAgentSummary[]): AppAgentSource {
    return {
        connect: () => {
            throw new Error("connect not used in this test");
        },
        listAvailableAgents: async () => agents,
    };
}

describe("findInstallableAgents", () => {
    it("returns an empty list when there are no sources", async () => {
        expect(await findInstallableAgents(fakeContext([]))).toEqual([]);
    });

    it("flattens installable agents across sources", async () => {
        const ctx = fakeContext([
            sourceReturning([summary("photo", "typeagent-feed", "Photos")]),
            sourceReturning([summary("montage", "catalog")]),
        ]);
        const names = (await findInstallableAgents(ctx)).map(
            (a) => a.installName,
        );
        expect(names.sort()).toEqual(["montage", "photo"]);
    });

    it("excludes agents that are already installed", async () => {
        const ctx = fakeContext(
            [
                sourceReturning([
                    summary("photo", "typeagent-feed"),
                    summary("montage", "typeagent-feed"),
                ]),
            ],
            ["montage"], // already installed
        );
        const names = (await findInstallableAgents(ctx)).map(
            (a) => a.installName,
        );
        expect(names).toEqual(["photo"]);
    });

    it("de-dupes the same install name across sources (first wins)", async () => {
        const ctx = fakeContext([
            sourceReturning([summary("photo", "feed-a", "from A")]),
            sourceReturning([summary("photo", "feed-b", "from B")]),
        ]);
        const result = await findInstallableAgents(ctx);
        expect(result).toHaveLength(1);
        expect(result[0].source).toBe("feed-a");
    });

    it("ignores a source whose discovery throws (best-effort)", async () => {
        const throwing: AppAgentSource = {
            connect: () => {
                throw new Error("connect not used");
            },
            listAvailableAgents: async () => {
                throw new Error("feed offline");
            },
        };
        const ctx = fakeContext([
            throwing,
            sourceReturning([summary("photo", "feed")]),
        ]);
        const names = (await findInstallableAgents(ctx)).map(
            (a) => a.installName,
        );
        expect(names).toEqual(["photo"]);
    });

    it("skips a source without a listAvailableAgents implementation", async () => {
        const noDiscovery: AppAgentSource = {
            connect: () => {
                throw new Error("connect not used");
            },
        };
        const ctx = fakeContext([
            noDiscovery,
            sourceReturning([summary("photo", "feed")]),
        ]);
        const names = (await findInstallableAgents(ctx)).map(
            (a) => a.installName,
        );
        expect(names).toEqual(["photo"]);
    });
});

describe("formatInstallableAgents", () => {
    it("reports when nothing is installable", () => {
        expect(formatInstallableAgents([])).toContain(
            "No additional agents are available",
        );
    });

    it("includes each agent's name, description, and install command", () => {
        const text = formatInstallableAgents([
            summary("photo", "feed", "Organize your photos"),
        ]);
        expect(text).toContain("photo");
        expect(text).toContain("Organize your photos");
        expect(text).toContain("@package install photo");
    });
});
