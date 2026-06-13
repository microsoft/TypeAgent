// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    RepoRootResolution,
    AgentLocation,
} from "@typeagent/core/runtime";
import type { CollisionDetectedEvent } from "@typeagent/core/events";
import {
    formatStudioInfo,
    formatCollisions,
    formatEvents,
} from "../src/lib/inspect.js";
import {
    resolveStudioRepoRootCandidates,
    getStudioRuntime,
} from "studio-service";

describe("studio inspect formatters", () => {
    it("formatStudioInfo lists agent locations with per-root counts and a total", () => {
        const info: RepoRootResolution = {
            repoRoot: "/repo/ts",
            agentsDirFound: true,
        };
        const locations: AgentLocation[] = [
            { root: "/repo/ts/packages/agents", exists: true, agentCount: 30 },
            { root: "/ext/agents", exists: true, agentCount: 3 },
        ];
        const md = formatStudioInfo(info, locations);
        expect(md).toContain("`/repo/ts`");
        expect(md).toContain("✅ `/repo/ts/packages/agents` — 30 agent(s)");
        expect(md).toContain("✅ `/ext/agents` — 3 agent(s)");
        expect(md).toContain("Agents discovered:** 33");
    });

    it("formatStudioInfo marks a missing location and warns when no agents dir", () => {
        const info: RepoRootResolution = {
            repoRoot: "/somewhere/else",
            agentsDirFound: false,
        };
        const locations: AgentLocation[] = [
            {
                root: "/somewhere/else/packages/agents",
                exists: false,
                agentCount: 0,
            },
        ];
        const md = formatStudioInfo(info, locations);
        expect(md).toContain(
            "⚠️ `/somewhere/else/packages/agents` — not found",
        );
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

    it("formatEvents lists recent events", () => {
        const md = formatEvents([
            { type: "sandbox.start", ts: 0 },
            { type: "collision.detected", ts: 1000 },
        ] as any);
        expect(md).toContain("## Events (2)");
        expect(md).toContain("**sandbox.start**");
        expect(md).toContain("**collision.detected**");
    });

    it("formatEvents handles the empty case", () => {
        expect(formatEvents([])).toContain("No events recorded");
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

    it("treats a null repoRoot like undefined (JSON sends undefined as null)", () => {
        // Over the WS channel, `undefined` args arrive as `null`; the guard
        // must not call `.trim()` on it. Should behave like the no-arg case.
        const viaNull = getStudioRuntime(null as unknown as string);
        const viaUndefined = getStudioRuntime();
        expect(viaNull).toBe(viaUndefined);
    });
});
