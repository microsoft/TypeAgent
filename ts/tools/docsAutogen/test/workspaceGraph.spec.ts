// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    buildGraph,
    parseWorkspacePatterns,
    type WorkspacePackage,
} from "../src/workspaceGraph.js";

function pkg(
    name: string,
    relDir: string,
    deps: Record<string, string> = {},
    devDeps: Record<string, string> = {},
): WorkspacePackage {
    return {
        name,
        dir: `/repo/ts/${relDir}`,
        relDir,
        packageJson: {
            name,
            dependencies: deps,
            devDependencies: devDeps,
        },
        isPrivate: false,
    };
}

describe("parseWorkspacePatterns", () => {
    it("extracts the packages: list", () => {
        const yaml = [
            "packages:",
            "  - packages/*",
            "  - packages/utils/*",
            "  - tools",
            "  - tools/*",
            "",
            "onlyBuiltDependencies:",
            "  - foo",
        ].join("\n");
        expect(parseWorkspacePatterns(yaml)).toEqual([
            "packages/*",
            "packages/utils/*",
            "tools",
            "tools/*",
        ]);
    });
    it("ignores comments and blank lines", () => {
        const yaml = [
            "# leading comment",
            "packages:",
            "  # commented entry",
            "  - packages/*  # trailing comment",
            "",
        ].join("\n");
        expect(parseWorkspacePatterns(yaml)).toEqual(["packages/*"]);
    });
    it("returns empty when no packages: key is present", () => {
        expect(parseWorkspacePatterns("foo: bar\n")).toEqual([]);
    });
});

describe("buildGraph", () => {
    it("links workspace:* deps and ignores external deps", () => {
        const a = pkg("@scope/a", "packages/a", {
            "@scope/b": "workspace:*",
            chalk: "^5.0.0",
        });
        const b = pkg("@scope/b", "packages/b");
        const c = pkg("@scope/c", "packages/c", { "@scope/a": "workspace:*" });
        const graph = buildGraph([a, b, c]);
        expect([...(graph.deps.get("@scope/a") ?? [])].sort()).toEqual([
            "@scope/b",
        ]);
        expect([...(graph.deps.get("@scope/c") ?? [])].sort()).toEqual([
            "@scope/a",
        ]);
        expect([...(graph.reverseDeps.get("@scope/a") ?? [])].sort()).toEqual([
            "@scope/c",
        ]);
        expect([...(graph.reverseDeps.get("@scope/b") ?? [])].sort()).toEqual([
            "@scope/a",
        ]);
        expect([...(graph.reverseDeps.get("@scope/c") ?? [])].sort()).toEqual(
            [],
        );
    });
    it("does not follow non-workspace version specifiers", () => {
        const a = pkg("@scope/a", "packages/a", { "@scope/b": "^1.0.0" });
        const b = pkg("@scope/b", "packages/b");
        const graph = buildGraph([a, b]);
        expect([...(graph.deps.get("@scope/a") ?? [])]).toEqual([]);
        expect([...(graph.reverseDeps.get("@scope/b") ?? [])]).toEqual([]);
    });
    it("does not follow deps to packages outside the workspace", () => {
        const a = pkg("@scope/a", "packages/a", {
            "@external/x": "workspace:*",
        });
        const graph = buildGraph([a]);
        expect([...(graph.deps.get("@scope/a") ?? [])]).toEqual([]);
    });
    it("merges dependencies and devDependencies into the same edge set", () => {
        const a = pkg(
            "@scope/a",
            "packages/a",
            { "@scope/b": "workspace:*" },
            { "@scope/c": "workspace:*" },
        );
        const b = pkg("@scope/b", "packages/b");
        const c = pkg("@scope/c", "packages/c");
        const graph = buildGraph([a, b, c]);
        expect([...(graph.deps.get("@scope/a") ?? [])].sort()).toEqual([
            "@scope/b",
            "@scope/c",
        ]);
    });
    it("ignores self-edges", () => {
        const a = pkg("@scope/a", "packages/a", { "@scope/a": "workspace:*" });
        const graph = buildGraph([a]);
        expect([...(graph.deps.get("@scope/a") ?? [])]).toEqual([]);
        expect([...(graph.reverseDeps.get("@scope/a") ?? [])]).toEqual([]);
    });
});
