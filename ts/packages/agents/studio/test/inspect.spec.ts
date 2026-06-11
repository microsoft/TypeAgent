// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AvailableAgent,
    RepoRootResolution,
} from "@typeagent/core/runtime";
import type { CollisionDetectedEvent } from "@typeagent/core/events";
import {
    formatAgentList,
    formatStudioInfo,
    formatCollisions,
} from "../src/lib/inspect.js";
import {
    resolveStudioRepoRootCandidates,
    getStudioRuntime,
} from "../src/lib/runtime.js";

describe("studio inspect formatters", () => {
    it("formatAgentList renders names with emoji and a count", () => {
        const agents: AvailableAgent[] = [
            { name: "calendar", emoji: "📅" },
            { name: "player", emoji: "🎵" },
            { name: "noEmoji" },
        ];
        const md = formatAgentList(agents);
        expect(md).toContain("## Agents (3)");
        expect(md).toContain("📅 calendar");
        expect(md).toContain("🎵 player");
        // Falls back to the default plug emoji when none is declared.
        expect(md).toContain("🔌 noEmoji");
    });

    it("formatAgentList handles the empty case with a hint", () => {
        const md = formatAgentList([]);
        expect(md).toContain("No agents discovered");
        expect(md).toContain("getStudioInfo");
    });

    it("formatStudioInfo reports the resolved root and agents-found state", () => {
        const info: RepoRootResolution = {
            repoRoot: "/repo/ts",
            agentsDirFound: true,
        };
        const md = formatStudioInfo(info, 12);
        expect(md).toContain("`/repo/ts`");
        expect(md).toContain("yes ✅");
        expect(md).toContain("Agents discovered:** 12");
    });

    it("formatStudioInfo warns when packages/agents is not found", () => {
        const info: RepoRootResolution = {
            repoRoot: "/somewhere/else",
            agentsDirFound: false,
        };
        const md = formatStudioInfo(info, 0);
        expect(md).toContain("no ⚠️");
        expect(md).toContain("TYPEAGENT_STUDIO_REPO_ROOT");
    });

    it("formatCollisions renders participants and exemplars", () => {
        const collisions = [
            {
                type: "collision.detected",
                kind: "overlap",
                detectionPoint: "grammar-edit",
                participants: [
                    {
                        agent: "player",
                        actionType: "play",
                        file: "a.agr",
                        range: [1, 2],
                    },
                    {
                        agent: "list",
                        actionType: "addItem",
                        file: "b.agr",
                        range: [3, 4],
                    },
                ],
                exemplarUtterances: ["play it", "add it"],
            } as unknown as CollisionDetectedEvent,
        ];
        const md = formatCollisions(collisions);
        expect(md).toContain("## Collisions (1)");
        expect(md).toContain("player.play ↔ list.addItem");
        expect(md).toContain('"play it"');
    });

    it("formatCollisions handles the empty case", () => {
        const md = formatCollisions([]);
        expect(md).toContain("No collisions recorded");
    });
});

describe("resolveStudioRepoRootCandidates", () => {
    it("prefers the explicit override, then cwd", () => {
        const candidates = resolveStudioRepoRootCandidates(
            { TYPEAGENT_STUDIO_REPO_ROOT: "/override/root" },
            "/current/dir",
        );
        expect(candidates).toEqual(["/override/root", "/current/dir"]);
    });

    it("falls back to cwd when no override is set", () => {
        expect(resolveStudioRepoRootCandidates({}, "/current/dir")).toEqual([
            "/current/dir",
        ]);
    });

    it("ignores a blank override", () => {
        expect(
            resolveStudioRepoRootCandidates(
                { TYPEAGENT_STUDIO_REPO_ROOT: "   " },
                "/current/dir",
            ),
        ).toEqual(["/current/dir"]);
    });
});

describe("getStudioRuntime", () => {
    it("caches one runtime per explicit repoRoot and reuses it", () => {
        const a1 = getStudioRuntime("/repo/alpha");
        const a2 = getStudioRuntime("/repo/alpha");
        const b = getStudioRuntime("/repo/beta");
        // Same root → same cached instance; different root → distinct instance.
        expect(a1).toBe(a2);
        expect(a1).not.toBe(b);
        // It points at the requested root rather than guessing.
        expect(a1.getRepoRootInfo().repoRoot).toBe("/repo/alpha");
        expect(b.getRepoRootInfo().repoRoot).toBe("/repo/beta");
    });

    it("falls back to the default candidates when no repoRoot is given", () => {
        const first = getStudioRuntime();
        const second = getStudioRuntime();
        expect(first).toBe(second);
    });
});
