// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    detectChangedPackages,
    DEFAULT_WATCHED_DIRS,
} from "../src/changeDetection.js";
import type { WorkspacePackage } from "../src/workspaceGraph.js";

function pkg(name: string, relDir: string): WorkspacePackage {
    return {
        name,
        dir: `/repo/ts/${relDir}`,
        relDir,
        packageJson: { name },
        isPrivate: false,
    };
}

const ALL = [
    pkg("@a/foo", "packages/foo"),
    pkg("@a/bar", "packages/bar"),
    pkg("@a/dispatcher", "packages/dispatcher"),
    pkg("@a/dispatcher-core", "packages/dispatcher/dispatcher"),
];

describe("detectChangedPackages", () => {
    it("flags a package when files under its src/ change", () => {
        const result = detectChangedPackages(ALL, [
            "packages/foo/src/index.ts",
        ]);
        expect(result.packages.map((p) => p.name)).toEqual(["@a/foo"]);
        expect(result.attributions[0]?.triggers).toBe(true);
        expect(result.attributions[0]?.pkg?.name).toBe("@a/foo");
    });

    it("flags a package when its package.json changes", () => {
        const result = detectChangedPackages(ALL, [
            "packages/foo/package.json",
        ]);
        expect(result.packages.map((p) => p.name)).toEqual(["@a/foo"]);
    });

    it("does NOT flag a package for README or test changes", () => {
        const result = detectChangedPackages(ALL, [
            "packages/foo/README.md",
            "packages/foo/test/foo.spec.ts",
            "packages/foo/dist/index.js",
        ]);
        expect(result.packages).toEqual([]);
        for (const a of result.attributions) {
            expect(a.triggers).toBe(false);
            expect(a.pkg?.name).toBe("@a/foo");
        }
    });

    it("attributes nested packages to the deepest match", () => {
        const result = detectChangedPackages(ALL, [
            "packages/dispatcher/dispatcher/src/main.ts",
        ]);
        expect(result.packages.map((p) => p.name)).toEqual([
            "@a/dispatcher-core",
        ]);
    });

    it("attributes parent-package files to the parent", () => {
        const result = detectChangedPackages(ALL, [
            "packages/dispatcher/src/util.ts",
        ]);
        expect(result.packages.map((p) => p.name)).toEqual(["@a/dispatcher"]);
    });

    it("returns null pkg for files outside any workspace package", () => {
        const result = detectChangedPackages(ALL, [
            "tools/docsAutogen/src/cli.ts",
            ".github/workflows/foo.yml",
        ]);
        expect(result.packages).toEqual([]);
        for (const a of result.attributions) {
            expect(a.pkg).toBeNull();
            expect(a.triggers).toBe(false);
        }
    });

    it("deduplicates multi-file changes within a single package", () => {
        const result = detectChangedPackages(ALL, [
            "packages/foo/src/a.ts",
            "packages/foo/src/sub/b.ts",
            "packages/foo/package.json",
        ]);
        expect(result.packages.map((p) => p.name)).toEqual(["@a/foo"]);
    });

    it("respects custom watched dirs", () => {
        const result = detectChangedPackages(ALL, ["packages/foo/lib/x.ts"], {
            watchedDirs: ["lib"],
        });
        expect(result.packages.map((p) => p.name)).toEqual(["@a/foo"]);
    });

    it("default watched dirs include only src", () => {
        expect([...DEFAULT_WATCHED_DIRS]).toEqual(["src"]);
    });

    it("returns sorted, deduplicated results across many packages", () => {
        const result = detectChangedPackages(ALL, [
            "packages/bar/src/x.ts",
            "packages/foo/src/x.ts",
            "packages/bar/package.json",
        ]);
        expect(result.packages.map((p) => p.name)).toEqual([
            "@a/bar",
            "@a/foo",
        ]);
    });
});
