// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Decide how much CI a change needs, from the files it touches and the pnpm
// workspace dependency graph.  Pure functions only; see ../ciScope.mjs for the
// CLI that feeds them from git and the file system.
//
//   skip - nothing CI-relevant changed
//   fast - every changed file belongs to a workspace package, and none of the
//          affected packages (changed + their workspace dependents) pulls in
//          a "heavy" dependency (native modules needing the full root
//          postinstall).  Only the affected packages are installed, built
//          and tested.
//   full - anything else (root config, lockfile, shared scripts, workflow,
//          a heavy package, or too many affected packages).

import path from "node:path";

// Any affected package whose dependency closure contains one of these needs
// the full pipeline (Electron rebuilds native modules and drives the UI tests).
export const HEAVY_DEPENDENCIES = ["electron"];

// The root postinstall provisions this native module; a partial install that
// doesn't contain it must skip that step (TYPEAGENT_SKIP_BETTER_SQLITE3=1).
export const SQLITE_DEPENDENCY = "better-sqlite3";

// Beyond this many affected packages the fast lane stops being worth it.
export const MAX_FAST_PACKAGES = 20;

const toPosix = (p) => p.split(path.sep).join("/");

// Expand the `packages:` globs of pnpm-workspace.yaml.  A segment may be a
// literal or "*" (one directory); "**" and partial wildcards are unsupported.
export function expandWorkspaceGlobs(globs, listDirs) {
    const dirs = [];
    for (const glob of globs) {
        let current = [""];
        for (const segment of glob.split("/")) {
            if (segment.includes("*") && segment !== "*") {
                throw new Error(`Unsupported workspace glob: ${glob}`);
            }
            const join = (base, child) => (base ? `${base}/${child}` : child);
            current = current.flatMap((base) =>
                segment === "*"
                    ? listDirs(base).map((child) => join(base, child))
                    : [join(base, segment)],
            );
        }
        dirs.push(...current);
    }
    return [...new Set(dirs)];
}

// packages: [{ dir, name, deps: [names of all deps incl. dev] }]
export function buildGraph(packages) {
    const byName = new Map(packages.map((p) => [p.name, p]));
    const dependents = new Map(packages.map((p) => [p.name, new Set()]));
    for (const p of packages) {
        for (const d of p.deps) {
            if (byName.has(d)) dependents.get(d).add(p.name);
        }
    }
    return { packages, byName, dependents };
}

// Workspace package that owns a ts/-relative file (deepest dir wins, so
// nested packages like agents/x/host/webview beat agents/x).
export function owningPackage(file, packages) {
    let best;
    for (const p of packages) {
        if (file.startsWith(`${p.dir}/`) && p.dir !== "") {
            if (!best || p.dir.length > best.dir.length) best = p;
        }
    }
    return best;
}

function closure(start, next) {
    const seen = new Set(start);
    const stack = [...start];
    while (stack.length) {
        for (const n of next(stack.pop())) {
            if (!seen.has(n)) {
                seen.add(n);
                stack.push(n);
            }
        }
    }
    return seen;
}

export function dependentsClosure(graph, names) {
    return closure(names, (n) => graph.dependents.get(n) ?? []);
}

export function dependencyClosure(graph, names) {
    return closure(names, (n) =>
        (graph.byName.get(n)?.deps ?? []).filter((d) => graph.byName.has(d)),
    );
}

export function usesDependency(graph, names, external) {
    for (const n of dependencyClosure(graph, names)) {
        const deps = graph.byName.get(n)?.deps ?? [];
        if (deps.some((d) => external.includes(d))) return true;
    }
    return false;
}

// Workspace packages whose changes always need a full run: tools-scripts holds
// the shared build/test/CI scripts used by every package.
export const FULL_RUN_PACKAGES = ["tools-scripts"];

// changedFiles: repo-relative paths.  extraFullTriggers: repo-relative
// prefixes that force a full run (e.g. the calling workflow file).
export function computeScope(changedFiles, graph, options = {}) {
    const { extraFullTriggers = [], maxFastPackages = MAX_FAST_PACKAGES } =
        options;
    const reasons = [];
    const changed = new Set();
    let relevant = false;
    for (const file of changedFiles.map(toPosix)) {
        if (extraFullTriggers.some((t) => file === t || file.startsWith(t))) {
            reasons.push(`${file} forces a full run`);
            relevant = true;
            continue;
        }
        // Outside ts/ (python, dotnet, docs): not this workflow's job.
        if (!file.startsWith("ts/")) continue;
        relevant = true;
        const pkg = owningPackage(file.slice(3), graph.packages);
        if (!pkg) {
            reasons.push(`${file} is not inside a workspace package`);
        } else if (FULL_RUN_PACKAGES.includes(pkg.name)) {
            reasons.push(`${file} is a shared build script`);
        } else {
            changed.add(pkg.name);
        }
    }
    if (!relevant) {
        return { mode: "skip", reasons, changed: [], affected: [], sqlite: false };
    }

    const affected = [...dependentsClosure(graph, [...changed])].sort();
    for (const name of affected) {
        if (usesDependency(graph, [name], HEAVY_DEPENDENCIES)) {
            reasons.push(`${name} depends on ${HEAVY_DEPENDENCIES.join("/")}`);
        }
    }
    if (affected.length > maxFastPackages) {
        reasons.push(`${affected.length} affected packages`);
    }
    return {
        mode: reasons.length ? "full" : "fast",
        reasons,
        changed: [...changed].sort(),
        affected,
        sqlite: usesDependency(graph, affected, [SQLITE_DEPENDENCY]),
    };
}

// pnpm --filter arguments: install/build need the affected packages and their
// dependencies; tests run only on the affected packages themselves.
export function pnpmFilters(affected, withDependencies) {
    return affected
        .map((n) => `--filter=${n}${withDependencies ? "..." : ""}`)
        .join(" ");
}
