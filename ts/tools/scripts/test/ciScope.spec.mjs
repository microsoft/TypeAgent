// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";

import {
    buildGraph,
    computeScope,
    expandWorkspaceGlobs,
    owningPackage,
    pnpmFilters,
} from "../lib/ciScope.mjs";

const graph = buildGraph([
    { dir: "packages/hooks", name: "hooks", deps: [] },
    { dir: "packages/git-story", name: "git-story", deps: ["hooks", "hono"] },
    { dir: "packages/plugin", name: "plugin", deps: ["hooks"] },
    { dir: "packages/storage", name: "storage", deps: ["better-sqlite3"] },
    { dir: "packages/app", name: "app", deps: ["storage"] },
    { dir: "packages/shell", name: "shell", deps: ["app", "electron"] },
    { dir: "packages/app/host/webview", name: "webview", deps: [] },
    { dir: "tools", name: "tools-scripts", deps: [] },
]);
const scope = (files, opts) => computeScope(files, graph, opts);

test("no ts changes skips", () => {
    assert.equal(scope(["python/x.py", "README.md"]).mode, "skip");
});

test("leaf package change is fast and scoped to it", () => {
    const s = scope(["ts/packages/git-story/src/a.ts"]);
    assert.equal(s.mode, "fast");
    assert.deepEqual(s.affected, ["git-story"]);
});

test("shared dependency pulls in its dependents", () => {
    const s = scope(["ts/packages/hooks/src/a.ts"]);
    assert.equal(s.mode, "fast");
    assert.deepEqual(s.affected, ["git-story", "hooks", "plugin"]);
});

test("electron in the affected closure forces full", () => {
    assert.equal(scope(["ts/packages/shell/a.ts"]).mode, "full");
    assert.equal(scope(["ts/packages/storage/a.ts"]).mode, "full");
});

test("sqlite users stay fast but need the sqlite postinstall", () => {
    assert.equal(scope(["ts/packages/git-story/a.ts"]).sqlite, false);
    const s = buildGraph(graph.packages.filter((p) => p.name !== "shell"));
    const r = computeScope(["ts/packages/storage/a.ts"], s);
    assert.equal(r.mode, "fast");
    assert.deepEqual(r.affected, ["app", "storage"]);
    assert.equal(r.sqlite, true);
});

test("root files, shared scripts and full triggers force full", () => {
    assert.equal(scope(["ts/pnpm-lock.yaml"]).mode, "full");
    assert.equal(scope(["ts/tools/scripts/x.mjs"]).mode, "full");
    const s = scope([".github/workflows/build-ts.yml"], {
        extraFullTriggers: [".github/workflows/build-ts.yml"],
    });
    assert.equal(s.mode, "full");
});

test("too many affected packages forces full", () => {
    const s = scope(["ts/packages/hooks/a.ts"], { maxFastPackages: 2 });
    assert.equal(s.mode, "full");
});

test("deepest owning package wins", () => {
    const pkg = owningPackage("packages/app/host/webview/a.ts", graph.packages);
    assert.equal(pkg.name, "webview");
});

test("expands workspace globs", () => {
    const dirs = expandWorkspaceGlobs(["tools", "packages/*"], () => [
        "a",
        "b",
    ]);
    assert.deepEqual(dirs, ["tools", "packages/a", "packages/b"]);
    const nested = expandWorkspaceGlobs(["agents/*/host/webview"], (d) =>
        d === "agents" ? ["x", "y"] : [],
    );
    assert.deepEqual(nested, [
        "agents/x/host/webview",
        "agents/y/host/webview",
    ]);
    assert.throws(() => expandWorkspaceGlobs(["packages/**"], () => []));
});

test("pnpm filters", () => {
    assert.equal(pnpmFilters(["a", "b"], true), "--filter=a... --filter=b...");
    assert.equal(pnpmFilters(["a"], false), "--filter=a");
});
