// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { resolveRepoRoot } from "@typeagent/core/runtime";

/** Build a predicate that reports `packages/agents` for an explicit set of dirs. */
function agentsAt(...roots: string[]): (root: string) => boolean {
    const set = new Set(roots.map((r) => path.normalize(r)));
    return (root) => set.has(path.normalize(root));
}

test("resolveRepoRoot returns a folder that directly contains packages/agents", () => {
    const ts = path.join("C:", "Git", "TypeAgent", "ts");
    const result = resolveRepoRoot([ts], "fallback", agentsAt(ts));
    assert.equal(result.agentsDirFound, true);
    assert.equal(path.normalize(result.repoRoot), path.normalize(ts));
});

test("resolveRepoRoot descends into the ts/ subdirectory when the git root is opened", () => {
    const gitRoot = path.join("C:", "Git", "TypeAgent");
    const ts = path.join(gitRoot, "ts");
    const result = resolveRepoRoot([gitRoot], "fallback", agentsAt(ts));
    assert.equal(result.agentsDirFound, true);
    assert.equal(path.normalize(result.repoRoot), path.normalize(ts));
});

test("resolveRepoRoot walks up ancestors when a nested folder is opened", () => {
    const ts = path.join("C:", "Git", "TypeAgent", "ts");
    const nested = path.join(ts, "packages", "agents", "player");
    const result = resolveRepoRoot([nested], "fallback", agentsAt(ts));
    assert.equal(result.agentsDirFound, true);
    assert.equal(path.normalize(result.repoRoot), path.normalize(ts));
});

test("resolveRepoRoot reports not-found and falls back to the first candidate", () => {
    const unrelated = path.join("D:", "some", "other", "project");
    const result = resolveRepoRoot([unrelated], "fallback", agentsAt());
    assert.equal(result.agentsDirFound, false);
    assert.equal(path.normalize(result.repoRoot), path.normalize(unrelated));
});

test("resolveRepoRoot uses the explicit fallback when no candidates are given", () => {
    const result = resolveRepoRoot([], "fallback-dir", agentsAt());
    assert.equal(result.agentsDirFound, false);
    assert.equal(result.repoRoot, "fallback-dir");
});

test("resolveRepoRoot prefers the first candidate that resolves", () => {
    const tsA = path.join("C:", "repoA", "ts");
    const tsB = path.join("C:", "repoB", "ts");
    const result = resolveRepoRoot(
        [path.join("C:", "repoA"), tsB],
        "fallback",
        agentsAt(tsA, tsB),
    );
    assert.equal(result.agentsDirFound, true);
    assert.equal(path.normalize(result.repoRoot), path.normalize(tsA));
});
