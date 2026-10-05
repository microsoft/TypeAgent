// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Decide how much CI a pull request needs from the files it touches.
// Pure functions only; ../ciScope.mjs is the CLI that feeds them from git.
//
//   skip - nothing under ts/ (or a full trigger) changed
//   fast - every ts/ change is inside FAST_PACKAGES; only the changed
//          packages (plus listed dependents) and their dependencies are
//          installed and built, and only those packages are tested
//   full - anything else

// Hardcoded list of leaf packages: no package outside this list may depend on
// one of them (enforced by test/ciScope.spec.mjs), so a change here can only
// break the listed packages.  Changing one also tests the listed packages that
// depend on it.  Key: directory under ts/, value: package name.
export const FAST_PACKAGES = {
    "packages/git-story": "git-story",
    "packages/copilot-memory-plugin": "@typeagent/copilot-memory-plugin",
    "packages/copilot-plugin": "@typeagent/copilot-plugin",
    "packages/copilot-plugin-eval": "@typeagent/copilot-plugin-eval",
};

// Dependents within FAST_PACKAGES (also checked by the spec).
export const FAST_DEPENDENTS = {
    "@typeagent/copilot-plugin": ["@typeagent/copilot-plugin-eval"],
};

// changedFiles: repo-relative paths.  fullTriggers: repo-relative paths or
// directory prefixes (ending in "/") that force a full run.
export function computeScope(changedFiles, options = {}) {
    const {
        fullTriggers = [],
        fastPackages = FAST_PACKAGES,
        fastDependents = FAST_DEPENDENTS,
    } = options;
    const reasons = [];
    const changed = new Set();
    let relevant = false;
    for (const raw of changedFiles) {
        const file = raw.replaceAll("\\", "/");
        if (fullTriggers.some((t) => file === t || (t.endsWith("/") && file.startsWith(t)))) {
            reasons.push(`${file} forces a full run`);
            relevant = true;
            continue;
        }
        // Outside ts/ (python, dotnet, docs): not this workflow's concern.
        if (!file.startsWith("ts/")) continue;
        relevant = true;
        const dir = Object.keys(fastPackages).find((d) =>
            file.startsWith(`ts/${d}/`),
        );
        if (dir) {
            changed.add(fastPackages[dir]);
            for (const d of fastDependents[fastPackages[dir]] ?? []) {
                changed.add(d);
            }
        }
        else reasons.push(`${file} is outside the fast-lane packages`);
    }
    if (!relevant) return { mode: "skip", reasons, packages: [] };
    return {
        mode: reasons.length ? "full" : "fast",
        reasons,
        packages: [...changed].sort(),
    };
}

// pnpm --filter arguments: install/build include each package's dependencies
// ("pkg..."); tests run on the changed packages only.
export function pnpmFilters(packages, withDependencies) {
    return packages
        .map((n) => `--filter=${n}${withDependencies ? "..." : ""}`)
        .join(" ");
}
