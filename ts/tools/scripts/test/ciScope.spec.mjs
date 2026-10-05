// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    FAST_DEPENDENTS,
    FAST_PACKAGES,
    computeScope,
    pnpmFilters,
} from "../lib/ciScope.mjs";

const tsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
);

test("no ts changes skips", () => {
    assert.equal(computeScope(["python/x.py", "README.md"]).mode, "skip");
});

test("changes confined to fast packages are fast", () => {
    const s = computeScope([
        "ts/packages/git-story/src/a.ts",
        "ts/packages/copilot-memory-plugin/README.md",
        "docs/x.md",
    ]);
    assert.equal(s.mode, "fast");
    assert.deepEqual(s.packages, [
        "@typeagent/copilot-memory-plugin",
        "git-story",
    ]);
});

test("any change outside the fast packages is full", () => {
    const s = computeScope([
        "ts/packages/git-story/src/a.ts",
        "ts/packages/agent-harness-hooks/src/a.ts",
    ]);
    assert.equal(s.mode, "full");
    assert.equal(computeScope(["ts/pnpm-lock.yaml"]).mode, "full");
    // Prefix match must be on a whole directory.
    assert.equal(computeScope(["ts/packages/git-story-x/a.ts"]).mode, "full");
});

test("full triggers force full", () => {
    const opts = {
        fullTriggers: [".github/workflows/build-ts.yml", "dotnet/broker/"],
    };
    assert.equal(
        computeScope([".github/workflows/build-ts.yml"], opts).mode,
        "full",
    );
    assert.equal(computeScope(["dotnet/broker/a.cs"], opts).mode, "full");
    assert.equal(computeScope(["dotnet/brokerX/a.cs"], opts).mode, "skip");
});

test("fast package list matches the workspace", () => {
    for (const [dir, name] of Object.entries(FAST_PACKAGES)) {
        const pkg = JSON.parse(
            fs.readFileSync(path.join(tsDir, dir, "package.json"), "utf8"),
        );
        assert.equal(pkg.name, name, dir);
    }
});

test("changing a fast package also tests its fast dependents", () => {
    const s = computeScope(["ts/packages/copilot-plugin/src/a.ts"]);
    assert.deepEqual(s.packages, [
        "@typeagent/copilot-plugin",
        "@typeagent/copilot-plugin-eval",
    ]);
});

// Guards the hardcoded list: every workspace package that depends on a fast
// package must itself be a fast package listed in FAST_DEPENDENTS.
test("only fast packages depend on fast packages", () => {
    const fastNames = new Set(Object.values(FAST_PACKAGES));
    const manifests = execFileSync("git", ["ls-files", "*package.json"], {
        cwd: tsDir,
        encoding: "utf8",
    })
        .split("\n")
        .filter((f) => f && !f.includes("node_modules"));
    for (const file of manifests) {
        const pkg = JSON.parse(fs.readFileSync(path.join(tsDir, file), "utf8"));
        const deps = Object.keys({
            ...pkg.dependencies,
            ...pkg.devDependencies,
            ...pkg.optionalDependencies,
            ...pkg.peerDependencies,
        });
        for (const dep of deps.filter((d) => fastNames.has(d))) {
            assert.ok(
                (FAST_DEPENDENTS[dep] ?? []).includes(pkg.name),
                `${pkg.name} (${file}) depends on fast package ${dep}; list it in FAST_DEPENDENTS or remove ${dep} from FAST_PACKAGES`,
            );
        }
    }
});

test("pnpm filters", () => {
    assert.equal(pnpmFilters(["a", "b"], true), "--filter=a... --filter=b...");
    assert.equal(pnpmFilters(["a"], false), "--filter=a");
});
