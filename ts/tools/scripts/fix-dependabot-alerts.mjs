#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Downloads open Dependabot alerts from GitHub and attempts to resolve them
 * by updating packages in the pnpm lock file via `pnpm update` or overrides.
 *
 * Usage:
 *   node tools/scripts/fix-dependabot-alerts.mjs [options]
 *
 * Options:
 *   --dry-run           Report what would be done without making changes
 *   --apply-overrides   Automatically add pnpm.overrides for transitive deps
 *                       that can't be updated directly
 *   --update-parents    Update parent packages in workspace package.json
 *                       files to fixed versions and run pnpm install
 *   --auto-fix          Shorthand for --apply-overrides --update-parents
 *   --show-chains       Show full dependency chains for transitive deps
 *                       (collapsed to 3 levels by default; use --show-chains=full
 *                       for expanded output)
 *   --prune-overrides   Remove pnpm.overrides entries that are no longer needed
 *   --json              Output results as structured JSON (for CI integration)
 *   --verbose           Show detailed constraint analysis, advisory IDs, and
 *                       debug output
 *   --help              Show this help message and exit
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import semver from "semver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const args = process.argv.slice(2);
const KNOWN_FLAG_PREFIXES = [
    "--dry-run",
    "--apply-overrides",
    "--update-parents",
    "--auto-fix",
    "--show-chains",
    "--prune-overrides",
    "--json",
    "--verbose",
    "--help",
];
const unknownFlags = args.filter(
    (a) =>
        a.startsWith("--") &&
        !KNOWN_FLAG_PREFIXES.some(
            (prefix) => a === prefix || a.startsWith(prefix + "="),
        ),
);
if (unknownFlags.length > 0) {
    console.error(
        `Error: unrecognized flag(s): ${unknownFlags.join(", ")}\nRun with --help to see available options.`,
    );
    process.exit(1);
}

/**
 * Parse a flag that may be a bare boolean or have a comma-separated
 * package list.  Returns:
 *   - false  if the flag is not present
 *   - true   if the flag is present without a value (apply to all)
 *   - Set    if the flag has a value (apply only to listed packages)
 */
function parseFilterFlag(flagName) {
    const arg = args.find(
        (a) => a === flagName || a.startsWith(flagName + "="),
    );
    if (!arg) return false;
    if (arg === flagName) return true;
    const value = arg.slice(flagName.length + 1);
    return new Set(
        value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    );
}

const DRY_RUN = args.includes("--dry-run");
const AUTO_FIX = parseFilterFlag("--auto-fix");
const _applyOverrides = parseFilterFlag("--apply-overrides");
const _updateParents = parseFilterFlag("--update-parents");

// Merge --auto-fix into the two sub-flags
const APPLY_OVERRIDES = mergeFilterFlags(AUTO_FIX, _applyOverrides);
const UPDATE_PARENTS = mergeFilterFlags(AUTO_FIX, _updateParents);

/**
 * Merge two filter flags.  If either is `true` (all), the result is `true`.
 * If both are `false`, the result is `false`.
 * Otherwise, merge the two Sets.
 */
function mergeFilterFlags(a, b) {
    if (a === true || b === true) return true;
    if (!a && !b) return false;
    if (!a) return b;
    if (!b) return a;
    return new Set([...a, ...b]);
}

/** Check if a filter flag enables a specific package. */
function flagAllows(flag, pkg) {
    if (flag === true) return true;
    if (flag instanceof Set) return flag.has(pkg);
    return false;
}
const SHOW_CHAINS =
    args.includes("--show-chains") || args.includes("--show-chains=full");
const SHOW_CHAINS_FULL = args.includes("--show-chains=full");
const PRUNE_OVERRIDES = args.includes("--prune-overrides");
const JSON_OUTPUT = args.includes("--json");
const VERBOSE = args.includes("--verbose");

if (args.includes("--help")) {
    console.log(`Usage: node tools/scripts/fix-dependabot-alerts.mjs [options]

Options:
  --dry-run           Report what would be done without making changes
  --apply-overrides[=pkg1,pkg2,...]
                      Automatically add pnpm.overrides for transitive deps
                      that can't be updated directly. Optionally specify
                      package names to limit which overrides to apply.
  --update-parents[=pkg1,pkg2,...]
                      Update parent packages in workspace package.json
                      files to fixed versions and run pnpm install.
                      Optionally specify package names to limit scope.
  --auto-fix[=pkg1,pkg2,...]
                      Shorthand for --apply-overrides --update-parents.
                      Optionally specify package names to limit scope.
  --show-chains       Show full dependency chains (collapsed to 3 levels)
  --show-chains=full  Show fully expanded dependency chains
  --prune-overrides   Remove pnpm.overrides entries that are no longer needed
  --json              Output results as structured JSON (for CI integration)
  --verbose           Show detailed constraint analysis, advisory IDs, and
                      debug output
  --help              Show this help message and exit`);
    process.exit(0);
}

// ── Color scheme ─────────────────────────────────────────────────────────────
// Severity ordering for sorting (higher = more severe)
const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };

// Category helpers — change colors in one place to restyle all output.
const clr = {
    fail: chalk.red, // status: fail ✗
    ok: chalk.greenBright, // status: success ✓
    warn: chalk.yellow, // status: warning ⚠
    version: chalk.yellowBright, // neutral version specs, upgrade hints
    versionOk: chalk.greenBright, // version that satisfies fix
    versionBad: chalk.redBright, // version that is vulnerable
    pkg: chalk.whiteBright, // package names (deps, parents, constraints)
    chain: chalk.blueBright, // dependency chain intermediate nodes
    root: chalk.blue, // workspace root names (dep chain leaves)
    chrome: chalk.cyanBright, // structural chrome (headers, CLI flags)
    meta: chalk.gray, // metadata, arrows, de-emphasized text
};

// ── Helpers ──────────────────────────────────────────────────────────────────

// Cache for npm/pnpm subprocess results to avoid redundant invocations
const _cache = {
    packageDeps: new Map(),
    latestVersion: new Map(),
    pnpmWhy: new Map(),
    workspacePkgPaths: null,
};

/**
 * Spawn a command with an argument array (no shell interpolation).
 * Throws on non-zero exit, spawn failure, or signal kill.
 */
function runCmd(cmd, cmdArgs, opts = {}) {
    const result = spawnSync(cmd, cmdArgs, {
        cwd: ROOT,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        ...opts,
    });
    if (result.error) {
        throw new Error(`Failed to spawn ${cmd}: ${result.error.message}`);
    }
    if (result.signal) {
        throw new Error(`${cmd} was killed by signal ${result.signal}`);
    }
    if (result.status !== 0) {
        throw new Error(
            `Command failed (exit ${result.status}): ${cmd} ${cmdArgs.join(" ")}\n${result.stderr}`,
        );
    }
    return result.stdout.trim();
}

/**
 * Like runCmd but returns null on failure instead of throwing.
 */
function tryRunCmd(cmd, cmdArgs, opts = {}) {
    const result = spawnSync(cmd, cmdArgs, {
        cwd: ROOT,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        ...opts,
    });
    if (result.error || result.signal || result.status !== 0) {
        verbose(
            `${cmd} ${cmdArgs.join(" ")} failed: ${result.error?.message || result.stderr?.trim() || `exit ${result.status}`}`,
        );
        return null;
    }
    return result.stdout.trim();
}

function verbose(msg) {
    if (VERBOSE && !JSON_OUTPUT) console.log(clr.meta(`  [verbose] ${msg}`));
}

function log(msg) {
    if (!JSON_OUTPUT) console.log(msg);
}
function header(msg) {
    if (!JSON_OUTPUT)
        console.log(
            `\n${clr.chrome("═".repeat(70))}\n  ${clr.chrome.bold(msg)}\n${clr.chrome("═".repeat(70))}`,
        );
}
function warn(msg) {
    if (!JSON_OUTPUT) console.log(clr.warn(`  ⚠  ${msg}`));
}
function ok(msg) {
    if (!JSON_OUTPUT) console.log(clr.ok(`  ✓  ${msg}`));
}
function fail(msg) {
    if (!JSON_OUTPUT) console.log(clr.fail(`  ✗  ${msg}`));
}
/**
 * Parse JSON output from `gh --paginate` or `pnpm --json` that may
 * concatenate multiple JSON arrays (e.g. `][` between pages).
 */
function parsePaginatedJson(raw) {
    // Try parsing as-is first; fall back to concatenation heuristic
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        // gh --paginate may concatenate multiple JSON arrays like `][`
        return JSON.parse("[" + raw.replace(/\]\s*\[/g, ",") + "]").flat();
    }
}

function fmtDepChain(whyData, pkg) {
    // Build a tree of intermediate → workspace roots (top-down from vuln pkg)
    // then render with one node per line, grouping leaves (workspace roots)
    function buildTree(node, isRoot) {
        if (node.depField) {
            return { label: node.name, depField: node.depField, children: [] };
        }
        const children = [];
        if (node.dependents) {
            for (const dep of node.dependents) {
                children.push(buildTree(dep, false));
            }
        }
        if (isRoot) {
            return { label: null, children }; // skip root, shown in 📦 header
        }
        return {
            label: `${node.name}@${node.version}`,
            children,
        };
    }

    // Merge duplicate subtrees and collect workspace roots as leaf groups
    function mergeChildren(children) {
        const byLabel = new Map();
        for (const child of children) {
            const key = child.label || "";
            if (byLabel.has(key)) {
                const existing = byLabel.get(key);
                existing.children.push(...child.children);
                if (child.depField) existing.depField = child.depField;
            } else {
                byLabel.set(key, { ...child, children: [...child.children] });
            }
        }
        for (const [, node] of byLabel) {
            node.children = mergeChildren(node.children);
        }
        return [...byLabel.values()];
    }

    function renderTree(nodes, depth, rendered) {
        const MAX_DEPTH = SHOW_CHAINS_FULL ? Infinity : 3;
        // Separate workspace roots (leaves) from intermediates
        const leaves = nodes.filter((n) => n.depField);
        const intermediates = nodes.filter((n) => !n.depField);

        if (depth >= MAX_DEPTH && intermediates.length > 0) {
            const indent = "     " + "  ".repeat(depth);
            log(
                `${indent}${clr.meta(`… ${intermediates.length} more level(s) collapsed (use --show-chains=full)`)}`,
            );
            return;
        }

        for (const node of intermediates) {
            const indent = "     " + "  ".repeat(depth);
            if (rendered.has(node.label)) {
                log(
                    `${indent}${clr.meta("→")} ${clr.chain(node.label)} ${clr.meta("(see above)")}`,
                );
                continue;
            }
            rendered.add(node.label);
            log(`${indent}${clr.meta("→")} ${clr.chain(node.label)}`);
            if (node.children.length > 0) {
                renderTree(node.children, depth + 1, rendered);
            }
        }

        if (leaves.length > 0) {
            const indent = "     " + "  ".repeat(depth);
            const maxShow = 3;
            const shown = leaves
                .slice(0, maxShow)
                .map((l) => clr.root(l.label));
            if (leaves.length > maxShow) {
                shown.push(clr.meta(`… +${leaves.length - maxShow} more`));
            }
            log(`${indent}${clr.meta("→")} ${shown.join(clr.meta(", "))}`);
        }
    }

    const roots = [];
    for (const entry of whyData) {
        const tree = buildTree(entry, true);
        roots.push(...tree.children);
    }
    const merged = mergeChildren(roots);
    if (merged.length > 0) {
        renderTree(merged, 0, new Set());
    }
}

function colorSeverity(severity) {
    switch (severity) {
        case "critical":
            return clr.fail.bold.inverse(` ${severity} `);
        case "high":
            return clr.fail.bold(severity);
        case "medium":
            return clr.warn(severity);
        case "low":
            return clr.meta(severity);
        default:
            return clr.meta(severity);
    }
}

// ── Utilities ────────────────────────────────────────────────────────────────

function getLatestVersion(pkg) {
    if (_cache.latestVersion.has(pkg)) return _cache.latestVersion.get(pkg);
    try {
        const output = tryRunCmd("npm", [
            "view",
            pkg,
            "dist-tags.latest",
            "--json",
        ]);
        if (!output || output === "undefined") return null;
        const version = JSON.parse(output);
        _cache.latestVersion.set(pkg, version);
        return version;
    } catch (e) {
        verbose(`getLatestVersion(${pkg}) failed: ${e.message}`);
        return null;
    }
}

/**
 * Extract unique sorted versions from pnpm-why data.
 */
function getResolvedVersions(whyData) {
    return [
        ...new Set(
            whyData.map((e) => e.version).filter((v) => v && semver.valid(v)),
        ),
    ].sort(semver.compare);
}

/**
 * Re-query `pnpm why` (clearing caches) after an update and verify
 * that every resolved version of `pkg` is >= `requiredVersion`.
 *
 * Returns { ok, versions, unfixed } where:
 *   - ok: true if all resolved versions are fixed
 *   - versions: all unique resolved versions
 *   - unfixed: versions still below requiredVersion
 */
function verifyAllVersionsFixed(pkg, requiredVersion) {
    _cache.pnpmWhy.delete(pkg);
    const versions = getResolvedVersions(getPnpmWhy(pkg));
    const unfixed = versions.filter((v) => semver.lt(v, requiredVersion));
    return { ok: unfixed.length === 0, versions, unfixed };
}

/**
 * Run `pnpm why <pkg> -r --json` and return parsed entries.
 */
function getPnpmWhy(pkg) {
    if (_cache.pnpmWhy.has(pkg)) return _cache.pnpmWhy.get(pkg);
    try {
        const output = tryRunCmd("pnpm", ["why", pkg, "-r", "--json"]);
        if (!output || output === "[]") return [];
        const result = parsePaginatedJson(output);
        _cache.pnpmWhy.set(pkg, result);
        return result;
    } catch (e) {
        verbose(`getPnpmWhy(${pkg}) failed: ${e.message}`);
        return [];
    }
}

function findConstrainingParentsFromData(whyData, pkg) {
    const parents = [];
    const seen = new Set();
    for (const entry of whyData) {
        if (entry.dependents) {
            for (const dep of entry.dependents) {
                const key = `${dep.name}@${dep.version}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const depSpec = getParentDepSpec(dep.name, dep.version, pkg);
                parents.push({
                    name: dep.name,
                    version: dep.version,
                    requiredSpec: depSpec,
                });
            }
        }
    }
    return parents;
}

/**
 * Get the version spec that parentPkg@parentVersion requires for depPkg.
 */
function getParentDepSpec(parentPkg, parentVersion, depPkg) {
    try {
        const deps = getPackageDeps(parentPkg, parentVersion);
        if (deps && deps[depPkg]) return deps[depPkg];
    } catch (e) {
        verbose(
            `getParentDepSpec(${parentPkg}@${parentVersion}, ${depPkg}) failed: ${e.message}`,
        );
    }
    return null;
}

function getPackageDeps(pkgName, version) {
    const cacheKey = `${pkgName}@${version}`;
    if (_cache.packageDeps.has(cacheKey))
        return _cache.packageDeps.get(cacheKey);

    // Check if this is a workspace package — read its package.json directly
    if (isWorkspacePackage(pkgName)) {
        const pkgJsonPath = getWorkspacePackagePaths().get(pkgName);
        try {
            const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
            const deps = pkgJson.dependencies || null;
            _cache.packageDeps.set(cacheKey, deps);
            return deps;
        } catch (e) {
            verbose(
                `getPackageDeps(${cacheKey}) workspace read failed: ${e.message}`,
            );
            return null;
        }
    }

    try {
        const output = tryRunCmd("npm", [
            "view",
            `${pkgName}@${version}`,
            "dependencies",
            "--json",
        ]);
        if (!output || output === "undefined") return null;
        const deps = JSON.parse(output);
        _cache.packageDeps.set(cacheKey, deps);
        return deps;
    } catch (e) {
        verbose(`getPackageDeps(${cacheKey}) failed: ${e.message}`);
        return null;
    }
}

function specAllowsVersion(spec, version) {
    try {
        return semver.satisfies(version, spec);
    } catch {
        return false;
    }
}

/**
 * Check if a dep spec guarantees that the resolved version will be
 * at least `minVersion`.  This is true when:
 *   1. The spec directly allows `minVersion` (e.g. ^5.4.0 allows 5.5.7), OR
 *   2. The spec's minimum resolvable version is >= minVersion
 *      (e.g. exact pin "5.5.8" → minVersion("5.5.8") = 5.5.8 >= 5.5.7).
 */
function specGuaranteesMinVersion(spec, minVersion) {
    try {
        if (semver.satisfies(minVersion, spec)) return true;
        const specMin = semver.minVersion(spec);
        if (specMin && semver.gte(specMin.version, minVersion)) return true;
        return false;
    } catch {
        return false;
    }
}

// ── Tree-walk fix planner ────────────────────────────────────────────────────
//
// The fix planner walks each resolved version of a vulnerable package
// bottom-up through the `pnpm why` dependents tree.  The lockfile can
// resolve *multiple* versions of the same package, so each version is
// analysed independently.
//
// At every edge in the tree the planner asks:
//   "Does the parent's dep spec allow the required child version?"
//
//   YES → pnpm update will resolve this edge – stop walking.
//   NO  → find a newer published version of the parent whose dep spec
//          *does* allow the required child version.
//         • Not found → BLOCKED (needs pnpm.overrides).
//         • Found     → the parent must be upgraded.  Recurse upward:
//                        does the grandparent's spec allow the new parent
//                        version?  Repeat until we hit a workspace root
//                        or another "allows" edge.
//
// When a workspace root is reached, its package.json spec is checked.
// If the spec is too narrow for the required child version, an
// `update-workspace` action is emitted (edit package.json + pnpm install).
//
// Possible strategies:
//   • update             — all parent specs allow the fix; just run
//                          `pnpm update <pkg> -r`.
//   • workspace          — a workspace package.json spec must be widened
//                          so a newer intermediate dep can be installed.
//   • override           — no parent upgrade exists; add pnpm.overrides.
//
// Results are cached by (parent@version → child ≥ requiredVersion) to
// avoid redundant npm-registry lookups across duplicate sub-trees.
//
// Entry point: planFixes() → called from classifyWithFixPlan()
//              classifyWithFixPlan() → called from analyzeVulnerabilities()
//              executeResolutions() consumes the resulting fixPlan.

/**
 * Look up the dep spec a workspace package.json has for `depPkg`.
 * Returns { spec, depField, pkgJsonPath } or null if not found.
 */
function getWorkspaceDepInfo(workspaceName, depPkg) {
    const pkgJsonPath = getWorkspacePackagePaths().get(workspaceName);
    if (!pkgJsonPath) return null;
    try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        for (const field of ["dependencies", "devDependencies"]) {
            if (pkgJson[field]?.[depPkg]) {
                return {
                    spec: pkgJson[field][depPkg],
                    depField: field,
                    pkgJsonPath,
                };
            }
        }
    } catch {}
    return null;
}

/**
 * Find the smallest published version of `pkgName` newer than
 * `currentVersion` whose dependency on `depPkg` allows (or drops)
 * `requiredDepVersion`.  Returns the version string or null.
 */
function findVersionThatAllows(
    pkgName,
    currentVersion,
    depPkg,
    requiredDepVersion,
) {
    if (isWorkspacePackage(pkgName)) return null;

    try {
        const npmInfo = tryRunCmd("npm", [
            "view",
            pkgName,
            "versions",
            "dist-tags.latest",
            "--json",
        ]);
        if (!npmInfo) return null;
        const npmData = JSON.parse(npmInfo);
        const latestVersion =
            npmData["dist-tags.latest"] || npmData["dist-tags"]?.latest;
        const allVersions = npmData.versions || [];

        // Check latest first (most common fix path)
        if (latestVersion && latestVersion !== currentVersion) {
            const deps = getPackageDeps(pkgName, latestVersion);
            if (deps) {
                const spec = deps[depPkg];
                if (
                    !spec ||
                    specGuaranteesMinVersion(spec, requiredDepVersion)
                ) {
                    return latestVersion;
                }
            }
        }

        // Scan recent versions newer than current
        if (allVersions.length > 0) {
            const candidates = allVersions
                .filter((v) => semver.gt(v, currentVersion))
                .slice(-10);
            for (const ver of candidates) {
                const deps = getPackageDeps(pkgName, ver);
                if (!deps) continue;
                const spec = deps[depPkg];
                if (
                    !spec ||
                    specGuaranteesMinVersion(spec, requiredDepVersion)
                ) {
                    return ver;
                }
            }
        }
    } catch (e) {
        verbose(`findVersionThatAllows(${pkgName}) failed: ${e.message}`);
    }
    return null;
}

/**
 * Recursively walk up the pnpm-why dependents tree to determine what
 * actions are needed so that `childPkg@requiredChildVersion` can resolve.
 *
 * @param {object[]} parentNodes  - dependents array from pnpm-why
 * @param {string}   childPkg    - package that needs the required version
 * @param {string}   requiredChildVersion - minimum version needed
 * @param {Map}      cache       - memoisation map
 * @returns {{ actions: object[], blocked: boolean, blockReasons: string[],
 *             constraints: object[] }}
 */
function walkUpTree(parentNodes, childPkg, requiredChildVersion, cache) {
    const actions = [];
    const blockReasons = [];
    const constraints = [];
    let blocked = false;

    for (const node of parentNodes) {
        // ── Workspace root ───────────────────────────────────────────────────
        if (node.depField) {
            const info = getWorkspaceDepInfo(node.name, childPkg);
            if (info && !specAllowsVersion(info.spec, requiredChildVersion)) {
                const newSpec = buildVersionSpec(
                    info.spec,
                    requiredChildVersion,
                );
                actions.push({
                    type: "update-workspace",
                    workspace: node.name,
                    pkg: childPkg,
                    oldSpec: info.spec,
                    newSpec,
                    depField: info.depField,
                    pkgJsonPath: info.pkgJsonPath,
                });
            }
            // else: spec already allows it or child is transitive — pnpm update handles it
            continue;
        }

        // ── Intermediate package ─────────────────────────────────────────────
        const cacheKey = `${node.name}@${node.version}\u2192${childPkg}\u2265${requiredChildVersion}`;
        if (cache.has(cacheKey)) {
            const cached = cache.get(cacheKey);
            actions.push(...cached.actions);
            blockReasons.push(...cached.blockReasons);
            constraints.push(...cached.constraints);
            if (cached.blocked) blocked = true;
            continue;
        }

        const result = {
            actions: [],
            blocked: false,
            blockReasons: [],
            constraints: [],
        };

        const depSpec = getParentDepSpec(node.name, node.version, childPkg);
        const allows =
            !depSpec || specGuaranteesMinVersion(depSpec, requiredChildVersion);

        result.constraints.push({
            parent: node.name,
            parentVersion: node.version,
            child: childPkg,
            requiredSpec: depSpec,
            allows,
            fixVersion: null,
        });

        if (allows) {
            // Parent already allows it — pnpm update resolves this edge.
            // No need to walk further; the parent itself stays at its
            // current version.
        } else {
            // Parent blocks — find a newer version that allows it
            if (process.stderr.isTTY && !JSON_OUTPUT) {
                process.stderr.write(
                    `\r\x1b[K  \ud83d\udd0d ${clr.meta(`Checking npm for ${node.name} versions that fix ${childPkg}...`)}`,
                );
            }

            const fixVersion = findVersionThatAllows(
                node.name,
                node.version,
                childPkg,
                requiredChildVersion,
            );

            if (!fixVersion) {
                result.blocked = true;
                result.blockReasons.push(
                    `${node.name}@${node.version} has no upgrade that allows ${childPkg}>=${requiredChildVersion}`,
                );
            } else {
                // Record the fix version for display
                result.constraints[result.constraints.length - 1].fixVersion =
                    fixVersion;

                // Recurse: can the parent's parents accommodate node@fixVersion?
                if (node.dependents && node.dependents.length > 0) {
                    const upResult = walkUpTree(
                        node.dependents,
                        node.name,
                        fixVersion,
                        cache,
                    );
                    result.actions.push(...upResult.actions);
                    result.constraints.push(...upResult.constraints);
                    if (upResult.blocked) {
                        result.blocked = true;
                        result.blockReasons.push(...upResult.blockReasons);
                    }
                }

                // If the path through this intermediate is unblocked,
                // emit an action to update it so pnpm can resolve the
                // child to the required version.
                if (!result.blocked) {
                    result.actions.push({
                        type: "update-intermediate",
                        pkg: node.name,
                        fromVersion: node.version,
                        toVersion: fixVersion,
                    });
                }
            }
        }

        cache.set(cacheKey, result);
        actions.push(...result.actions);
        blockReasons.push(...result.blockReasons);
        constraints.push(...result.constraints);
        if (result.blocked) blocked = true;
    }

    return { actions, blocked, blockReasons, constraints };
}

/**
 * Analyse every resolved instance of a vulnerable package and produce
 * a fix plan with concrete actions.
 *
 * Iterates each entry from `pnpm why <pkg> -r --json`.  Each entry
 * represents a distinct resolved version.  Entries whose version
 * already satisfies `requiredVersion` are skipped.  For the rest,
 * `walkUpTree` is called to determine what actions are needed.
 *
 * Results are partitioned per-version so that unblocked subtrees can
 * be acted on even when other subtrees are blocked.  A shared `cache`
 * Map avoids redundant npm-registry lookups across duplicate sub-trees.
 *
 * @param {string}   pkg             - vulnerable package name
 * @param {string}   requiredVersion - minimum safe version (from advisory)
 * @param {object[]} whyData         - parsed output of `pnpm why <pkg> -r --json`
 * @returns {{ unblockedActions: object[], blockedVersions: string[],
 *             blockReasons: string[], constraints: object[] }}
 */
function planFixes(pkg, requiredVersion, whyData) {
    const cache = new Map();
    const unblockedActions = [];
    const blockedVersions = [];
    const allBlockReasons = [];
    const allConstraints = [];

    for (const entry of whyData) {
        if (!entry.version || !semver.valid(entry.version)) continue;
        if (semver.gte(entry.version, requiredVersion)) continue; // already OK
        if (!entry.dependents || entry.dependents.length === 0) continue;

        const result = walkUpTree(
            entry.dependents,
            pkg,
            requiredVersion,
            cache,
        );
        allConstraints.push(...result.constraints);
        if (result.blocked) {
            blockedVersions.push(entry.version);
            allBlockReasons.push(...result.blockReasons);
        } else {
            unblockedActions.push(...result.actions);
        }
    }

    if (process.stderr.isTTY) {
        process.stderr.write("\r\x1b[K");
    }

    return {
        unblockedActions: deduplicateActions(unblockedActions),
        blockedVersions: [...new Set(blockedVersions)],
        blockReasons: [...new Set(allBlockReasons)],
        constraints: allConstraints,
    };
}

/**
 * Remove duplicate actions that can arise when the same sub-tree appears
 * in multiple dependency paths (common in monorepos with many workspaces).
 */
function deduplicateActions(actions) {
    const seen = new Set();
    const result = [];
    for (const action of actions) {
        const key = `${action.type}:${action.workspace ?? ""}:${action.pkg}:${action.newSpec ?? action.toVersion ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(action);
    }
    return result;
}

/**
 * Display constraint info gathered during the tree walk.
 *
 * Groups constraints into blocking chains (ending at a ✗ blocker) and
 * non-blocking entries (✓ parents that already allow the fix).
 *
 * For each blocker, shows:
 *   - "Blocked by: <blocker>" with the blocker's spec and latest version info
 *   - A condensed "path:" showing the chain from vuln pkg to blocker
 * For non-blockers, shows a simple "✓ parent" line.
 */
function displayConstraints(constraintInfo, vulnPkg) {
    if (!constraintInfo || constraintInfo.length === 0) return;

    // Deduplicate constraints
    const seen = new Set();
    const unique = [];
    for (const c of constraintInfo) {
        const key = `${c.parent}@${c.parentVersion}\u2192${c.child}:${c.requiredSpec ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(c);
    }
    if (unique.length === 0) return;

    // Separate: blockers (✗), upgradeable (↑), and allowing (✓)
    const blockers = unique.filter((c) => !c.allows && !c.fixVersion);
    const upgradeable = unique.filter((c) => !c.allows && c.fixVersion);
    const allowing = unique.filter((c) => c.allows);

    // Build chains: for each blocker, trace the path from vulnPkg to blocker
    // through the upgradeable constraints
    const blockerChains = [];
    const seenBlockers = new Set();

    for (const blocker of blockers) {
        const blockerKey = `${blocker.parent}@${blocker.parentVersion}`;
        if (seenBlockers.has(blockerKey)) continue;
        seenBlockers.add(blockerKey);

        // Walk backwards through upgradeable edges to build the path
        const chain = buildConstraintChain(vulnPkg, blocker, upgradeable);

        // Look up the blocker's latest version and check if it fixes things
        const blockerLatest = getLatestVersion(blocker.parent);
        let blockerLatestSpec = null;
        if (blockerLatest && blockerLatest !== blocker.parentVersion) {
            const deps = getPackageDeps(blocker.parent, blockerLatest);
            if (deps && deps[blocker.child]) {
                blockerLatestSpec = deps[blocker.child];
            }
        }

        blockerChains.push({
            blocker,
            chain,
            blockerLatest,
            blockerLatestSpec,
        });
    }

    // Render blocker chains
    for (const {
        blocker,
        chain,
        blockerLatest,
        blockerLatestSpec,
    } of blockerChains) {
        const blockerName = `${blocker.parent}@${blocker.parentVersion}`;

        // Blocker line
        log(`     ${clr.fail("\u2717")} ${clr.pkg.bold(blockerName)}`);

        // Show the path if there are intermediate steps
        if (chain.length > 0) {
            const pathParts = [clr.pkg(vulnPkg)];
            for (const step of chain) {
                const majorTag =
                    step.fixVersion &&
                    isBreakingBump(step.parentVersion, step.fixVersion)
                        ? clr.warn(" ⚠ breaking")
                        : "";
                pathParts.push(
                    clr.chain(`${step.parent}@${step.parentVersion}`) +
                        clr.meta(` (→ ${step.fixVersion})`) +
                        majorTag,
                );
            }
            pathParts.push(clr.pkg.bold(blocker.parent));
            log(
                `       ${clr.meta("path:")} ${pathParts.join(clr.meta(" ← "))}`,
            );
        }

        // Show what the blocker requires and what latest does
        // Use "pins" for exact specs, "depends on" for range specs
        let reqInfo;
        if (blocker.requiredSpec) {
            const isExact =
                /^\d/.test(blocker.requiredSpec) &&
                !blocker.requiredSpec.includes("||");
            reqInfo = isExact
                ? `pins ${blocker.child} ${blocker.requiredSpec}`
                : `depends on ${blocker.child} ${blocker.requiredSpec}`;
        } else {
            reqInfo = `depends on ${blocker.child}`;
        }

        let latestInfo;
        if (!blockerLatest || blockerLatest === blocker.parentVersion) {
            latestInfo = "already at latest";
        } else if (blockerLatestSpec) {
            // Check if latest version's spec would allow the required version
            const vulnRequiredVersion = unique.find(
                (c) => c.child === blocker.child && c.fixVersion,
            );
            const requiredChildVer = vulnRequiredVersion
                ? vulnRequiredVersion.fixVersion
                : null;
            const latestAllows = requiredChildVer
                ? specGuaranteesMinVersion(blockerLatestSpec, requiredChildVer)
                : false;
            if (latestAllows) {
                latestInfo = `latest ${blocker.parent}@${clr.versionOk(blockerLatest)} allows ${blockerLatestSpec} ${clr.versionOk("✓")}`;
            } else {
                latestInfo = `latest ${blocker.parent}@${clr.versionBad(blockerLatest)} still pins ${blockerLatestSpec}`;
            }
        } else {
            latestInfo = `latest ${blocker.parent}@${clr.versionOk(blockerLatest)} drops ${blocker.child} dep ${clr.versionOk("✓")}`;
        }
        log(`       ${clr.meta(reqInfo + ", " + latestInfo)}`);
    }

    // Render upgradeable intermediates: immediate parent → pnpm update action
    if (upgradeable.length > 0) {
        const renderedUpgrades = new Set();
        for (const u of upgradeable) {
            const lineKey = `${u.parent}@${u.parentVersion}→${u.fixVersion}`;
            if (renderedUpgrades.has(lineKey)) continue;
            renderedUpgrades.add(lineKey);
            log(
                `     ${clr.ok("\u2713")} ${clr.pkg(`${u.parent}@${u.parentVersion}`)} ${clr.meta("\u2192")} pnpm update ${clr.pkg(u.parent)} (${clr.versionBad(u.parentVersion)} ${clr.meta("\u2192")} ${clr.versionOk(u.fixVersion)})`,
            );
        }
    }

    // Render non-blocking parents that don't have a related upgradeable
    if (allowing.length > 0) {
        const upgradeableParentNames = new Set(
            upgradeable.map((u) => u.parent),
        );
        const renderedAllowing = new Set();
        for (const c of allowing) {
            // Skip if this parent's child is an upgradeable (already shown above)
            if (upgradeableParentNames.has(c.child)) continue;
            const lineKey = `${c.parent}@${c.parentVersion}`;
            if (renderedAllowing.has(lineKey)) continue;
            renderedAllowing.add(lineKey);
            log(
                `     ${clr.ok("\u2713")} ${clr.pkg(`${c.parent}@${c.parentVersion}`)}`,
            );
        }
    }
}

/**
 * Build a condensed chain of upgradeable constraints between vulnPkg and
 * a blocker.  Returns an array of constraint steps (from vulnPkg outward).
 *
 * Each step is an upgradeable constraint (has fixVersion).
 * We trace: vulnPkg → child of some constraint → parent → ... → blocker.child
 */
function buildConstraintChain(vulnPkg, blocker, upgradeable) {
    // Build a lookup: child → list of upgradeable parents
    const byChild = new Map();
    for (const c of upgradeable) {
        if (!byChild.has(c.child)) byChild.set(c.child, []);
        byChild.get(c.child).push(c);
    }

    // BFS from blocker.child backwards to vulnPkg through upgradeable edges
    // The chain is: vulnPkg ← parent1 ← parent2 ← ... ← blocker
    // blocker.child is some intermediate package that the blocker constrains.
    // We want to find a path from vulnPkg to blocker.child through edges
    // where child→parent is an upgradeable constraint.

    // Direct case: blocker.child === vulnPkg (blocker directly depends on vuln pkg)
    if (blocker.child === vulnPkg) {
        return [];
    }

    // Find path from vulnPkg to blocker.child through upgradeable constraints
    // Each upgradeable constraint says: parent requires child, and parent can
    // be upgraded to fixVersion. So child → parent is an edge.
    const visited = new Set();
    const queue = [[vulnPkg, []]]; // [currentPkg, pathSoFar]
    visited.add(vulnPkg);

    while (queue.length > 0) {
        const [current, path] = queue.shift();
        const parents = byChild.get(current) || [];
        for (const constraint of parents) {
            const parentKey = `${constraint.parent}@${constraint.parentVersion}`;
            if (visited.has(parentKey)) continue;
            visited.add(parentKey);

            const newPath = [...path, constraint];

            // Did we reach the package that the blocker constrains?
            if (
                constraint.parent === blocker.child ||
                constraint.parent === blocker.parent
            ) {
                // If we reached the blocker's child, the path is complete
                if (constraint.parent === blocker.child) {
                    return newPath;
                }
                // If we reached the blocker itself via an upgradeable edge, trim it
                return newPath.slice(0, -1);
            }

            queue.push([constraint.parent, newPath]);
        }
    }

    // Couldn't trace a full path — return whatever upgradeable constraints
    // involve vulnPkg directly
    return (byChild.get(vulnPkg) || []).filter(
        (c) => c.parent !== blocker.parent,
    );
}

/**
 * Apply update-workspace actions: edit workspace package.json files.
 * Returns the number of updates applied.
 */
function applyFixActions(actions) {
    const wsUpdates = actions.filter((a) => a.type === "update-workspace");
    if (wsUpdates.length === 0) return 0;

    const byFile = new Map();
    for (const u of wsUpdates) {
        if (!byFile.has(u.pkgJsonPath)) byFile.set(u.pkgJsonPath, []);
        byFile.get(u.pkgJsonPath).push(u);
    }

    let appliedCount = 0;
    for (const [pkgJsonPath, fileUpdates] of byFile) {
        try {
            const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
            let updated = false;
            for (const u of fileUpdates) {
                if (pkgJson[u.depField]?.[u.pkg]) {
                    pkgJson[u.depField][u.pkg] = u.newSpec;
                    updated = true;
                    appliedCount++;
                    ok(
                        `${u.workspace}: ${u.pkg} ${clr.versionBad(u.oldSpec)} \u2192 ${clr.versionOk(u.newSpec)} in ${u.depField}`,
                    );
                }
            }
            if (updated) {
                writeFileSync(
                    pkgJsonPath,
                    JSON.stringify(pkgJson, null, 2) + "\n",
                    "utf-8",
                );
            }
        } catch (e) {
            warn(`Failed to update ${pkgJsonPath}: ${e.message}`);
        }
    }
    return appliedCount;
}

/**
 * Returns true if upgrading from oldVersion to newVersion is a breaking
 * semver change: either a major version bump, or a minor bump within 0.x
 * (where 0.x → 0.y is considered breaking by convention).
 */
function isBreakingBump(oldVersion, newVersion) {
    try {
        const oldMajor = semver.major(oldVersion);
        const newMajor = semver.major(newVersion);
        if (newMajor > oldMajor) return true;
        // In 0.x, minor bumps are breaking
        if (
            oldMajor === 0 &&
            newMajor === 0 &&
            semver.minor(newVersion) > semver.minor(oldVersion)
        ) {
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Build a new version spec preserving the range prefix from the old spec.
 * e.g. oldSpec="^1.2.3", newVersion="1.5.0" → "^1.5.0"
 */
function buildVersionSpec(oldSpec, newVersion) {
    if (
        oldSpec === "*" ||
        oldSpec === "latest" ||
        oldSpec.startsWith("workspace:")
    ) {
        return oldSpec;
    }
    const prefixMatch = oldSpec.match(/^([~^]|>=?)/);
    const prefix = prefixMatch ? prefixMatch[0] : "^";
    return `${prefix}${newVersion}`;
}

/**
 * Detect installed versions of `pkg` that would cross a major semver
 * boundary if forced to `patchedVersion` via override.
 * Returns an array of currently-installed versions that would cross major.
 */
function detectCrossMajorOverride(pkg, patchedVersion) {
    const whyData = getPnpmWhy(pkg);
    const installedVersions = whyData
        .map((e) => e.version)
        .filter((v) => v && semver.valid(v));
    const unique = [...new Set(installedVersions)];
    return unique.filter(
        (v) =>
            semver.lt(v, patchedVersion) && isBreakingBump(v, patchedVersion),
    );
}

// ── Fix plan query helpers ───────────────────────────────────────────────────
// Every decision about what to do with an entry is derived from its
// `fixPlan` (or absence thereof).

/** True when some resolved versions are blocked and need pnpm.overrides. */
function needsOverride(entry) {
    return entry.fixPlan?.blockedVersions?.length > 0;
}

/** True when workspace/intermediate actions are needed (unblocked path). */
function hasUnblockedActions(entry) {
    return entry.fixPlan?.unblockedActions?.length > 0;
}

/** True when a simple `pnpm update` is sufficient (no actions, no blocks). */
function isSimpleUpdate(entry) {
    return (
        entry.fixPlan && !needsOverride(entry) && !hasUnblockedActions(entry)
    );
}

/**
 * Assess the risk of a fix action for a given analysis entry.
 * Works for entries with unblocked actions or overrides.
 * Returns { level: "low"|"medium"|"high", reason: string }.
 */
function assessRisk(entry) {
    const { pkg, patched, currentVersion } = entry;

    // Check for cross-major bump
    const crossMajor =
        currentVersion &&
        semver.valid(currentVersion) &&
        semver.valid(patched) &&
        isBreakingBump(currentVersion, patched);

    if (hasUnblockedActions(entry)) {
        const wsActions =
            entry.fixPlan?.unblockedActions?.filter(
                (a) => a.type === "update-workspace",
            ) || [];
        const majorUpdates = wsActions.filter((a) => {
            const oldMin = semver.minVersion(a.oldSpec);
            const newMin = semver.minVersion(a.newSpec);
            return (
                oldMin &&
                newMin &&
                isBreakingBump(oldMin.version, newMin.version)
            );
        });

        if (crossMajor || majorUpdates.length > 0) {
            const parts = [];
            if (crossMajor)
                parts.push(`major bump ${currentVersion} → ${patched}`);
            if (majorUpdates.length > 0) {
                const names = majorUpdates.map((a) => a.pkg).join(", ");
                parts.push(
                    `${majorUpdates.length} workspace dep(s) need breaking bump: ${names}`,
                );
            }
            return { level: "high", reason: parts.join(", ") };
        }
        if (wsActions.length >= 3) {
            return {
                level: "medium",
                reason: `${wsActions.length} workspace package.json files to update`,
            };
        }
        return {
            level: "low",
            reason: `${wsActions.length || 1} workspace update(s), patch/minor bump`,
        };
    }

    // Override-based entries
    const whyData = getPnpmWhy(pkg);
    const parents = findConstrainingParentsFromData(whyData, pkg);
    const blockingParents = parents.filter(
        (p) =>
            p.requiredSpec &&
            !specGuaranteesMinVersion(p.requiredSpec, patched),
    );

    if (crossMajor) {
        return {
            level: "high",
            reason: `major version bump ${currentVersion} → ${patched}, ${blockingParents.length} parent(s) may break`,
        };
    }
    if (blockingParents.length >= 3) {
        return {
            level: "medium",
            reason: `${blockingParents.length} parent(s) constrain this package`,
        };
    }
    return {
        level: "low",
        reason: `patch/minor bump, ${blockingParents.length || "no"} constrained parent(s)`,
    };
}

/**
 * Returns a Map of workspace package name → absolute package.json path.
 */
function getWorkspacePackagePaths() {
    if (_cache.workspacePkgPaths) return _cache.workspacePkgPaths;
    _cache.workspacePkgPaths = new Map();
    try {
        const output = tryRunCmd("pnpm", [
            "ls",
            "-r",
            "--depth",
            "-1",
            "--json",
        ]);
        if (!output) return _cache.workspacePkgPaths;
        const parsed = parsePaginatedJson(output);
        for (const ws of parsed) {
            if (ws.name && ws.path) {
                _cache.workspacePkgPaths.set(
                    ws.name,
                    resolve(ws.path, "package.json"),
                );
            }
        }
    } catch (e) {
        verbose(`getWorkspacePackagePaths failed: ${e.message}`);
        warn("Could not build workspace package path map");
    }
    return _cache.workspacePkgPaths;
}

function isWorkspacePackage(pkgName) {
    return getWorkspacePackagePaths().has(pkgName);
}

/**
 * Add multiple pnpm.overrides entries in a single read/write cycle.
 * @param {Map<string, string>} overridesMap - package name → version spec
 */
function addOverrides(overridesMap) {
    const pkgJsonPath = resolve(ROOT, "package.json");
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));

    if (!pkgJson.pnpm) pkgJson.pnpm = {};
    if (!pkgJson.pnpm.overrides) pkgJson.pnpm.overrides = {};

    for (const [pkg, versionSpec] of overridesMap) {
        pkgJson.pnpm.overrides[pkg] = versionSpec;
    }

    writeFileSync(
        pkgJsonPath,
        JSON.stringify(pkgJson, null, 2) + "\n",
        "utf-8",
    );
}

/**
 * Run planFixes on a set of vulnerable whyData entries
 * and populate fixPlan + blockingReasons.
 *
 * Four outcomes (derived from the fixPlan):
 *   1. No actions, no blocked versions — isSimpleUpdate()
 *      All parent specs already allow the patched version; a simple
 *      `pnpm update <pkg> -r` will resolve the lockfile.
 *
 *   2. Has unblocked actions, no blocked versions — hasUnblockedActions() && !needsOverride()
 *      Some workspace package.json files need version bumps before the
 *      fix can propagate.  Requires --update-parents (or --auto-fix).
 *
 *   3. All versions blocked — needsOverride() && !hasUnblockedActions()
 *      Every resolved version's tree is blocked.  Requires pnpm.overrides.
 *
 *   4. Mixed: some unblocked, some blocked — hasUnblockedActions() && needsOverride()
 *      Unblocked subtrees get workspace/update actions; blocked subtrees
 *      need pnpm.overrides.  Both --update-parents and --apply-overrides
 *      are needed for a full fix.
 */

// ── Compact display helpers ──────────────────────────────────────────────────
//
// These functions produce the redesigned 2-4 line per-package output.
// The detailed constraint/chain output is gated behind --verbose / --show-chains.

/**
 * Extract workspace root names from pnpm-why data by walking the dependents
 * tree to find leaf nodes (those with a `depField` property).
 */
function extractWorkspaceRoots(whyData) {
    const roots = new Set();
    function walk(node) {
        if (node.depField) {
            roots.add(node.name);
            return;
        }
        if (node.dependents) {
            for (const dep of node.dependents) walk(dep);
        }
    }
    for (const entry of whyData) {
        if (entry.dependents) {
            for (const dep of entry.dependents) walk(dep);
        }
    }
    return [...roots].sort();
}

/**
 * Format the reason-centric action list for a vulnerability fix.
 * Each line explains WHY an action is needed, tagged with the action type.
 *
 * Tags:
 *   [workspace]   — a workspace package.json dep spec is too narrow
 *   [update]      — an intermediate package needs updating to widen its dep spec
 *   [override]    — no parent upgrade can fix this; needs pnpm.overrides
 */
function formatActions(entry) {
    const { pkg, patched, fixPlan } = entry;
    const lines = [];

    // Risk assessment for non-trivial fixes
    let riskLine = null;
    if (hasUnblockedActions(entry) || needsOverride(entry)) {
        const risk = assessRisk(entry);
        const riskIcon =
            risk.level === "high"
                ? clr.fail("▲ high")
                : risk.level === "medium"
                  ? clr.warn("■ medium")
                  : clr.ok("▽ low");
        riskLine = `Risk: ${riskIcon} ${clr.meta("—")} ${clr.meta(risk.reason)}`;
    }

    if (isSimpleUpdate(entry)) {
        lines.push(`Fix: ${clr.chrome(`pnpm update ${pkg} -r`)}`);
        return lines;
    }

    // Check if required flags are present
    const needsFlags = entry.blockingReasons.length > 0;
    const flagHint = needsFlags
        ? ` ${clr.meta("(requires")} ${clr.chrome("--auto-fix")}${clr.meta(")")}`
        : "";

    // Build a lookup of constraints for richer "why" descriptions
    const constraints = fixPlan?.constraints || [];

    // Workspace package.json updates — spec is too narrow
    const wsActions =
        fixPlan?.unblockedActions?.filter(
            (a) => a.type === "update-workspace",
        ) || [];
    for (const act of wsActions) {
        lines.push(
            `  ${clr.chrome("[workspace]")} ${clr.pkg(act.workspace)} depends on ${clr.pkg(act.pkg)} ${clr.versionBad(act.oldSpec)}, needs ${clr.versionOk(act.newSpec)} for fix`,
        );
    }

    // Intermediate package updates — their dep spec blocks the fix
    const intermediateActions =
        fixPlan?.unblockedActions?.filter(
            (a) => a.type === "update-intermediate",
        ) || [];
    const seenIntermediates = new Set();
    for (const act of intermediateActions) {
        if (seenIntermediates.has(act.pkg)) continue;
        seenIntermediates.add(act.pkg);
        // Find the matching constraint to explain what spec blocks it
        const constraint = constraints.find(
            (c) =>
                c.parent === act.pkg &&
                c.parentVersion === act.fromVersion &&
                !c.allows,
        );
        const reason = constraint?.requiredSpec
            ? `depends on ${clr.pkg(constraint.child)} ${clr.version(constraint.requiredSpec)}, blocking fix`
            : `blocks ${clr.pkg(pkg)} from resolving`;
        lines.push(
            `  ${clr.chrome("[update]")} ${clr.pkg(act.pkg)}${clr.meta("@")}${clr.versionBad(act.fromVersion)} ${reason} ${clr.meta("→")} ${clr.versionOk(act.toVersion)} fixes it`,
        );
    }

    // Override — explain why no parent update can help
    if (needsOverride(entry)) {
        // Find the blockers (constraints with no fixVersion)
        const blockers = constraints.filter((c) => !c.allows && !c.fixVersion);
        const seenBlockers = new Set();
        for (const b of blockers) {
            const key = `${b.parent}@${b.parentVersion}`;
            if (seenBlockers.has(key)) continue;
            seenBlockers.add(key);
            const specDesc = b.requiredSpec
                ? `pins ${clr.pkg(b.child)} ${clr.version(b.requiredSpec)}`
                : `blocks ${clr.pkg(b.child)}`;
            const blockerLatest = getLatestVersion(b.parent);
            let latestNote = "";
            if (!blockerLatest || blockerLatest === b.parentVersion) {
                latestNote = clr.meta(", already at latest");
            }
            const scopeNote = hasUnblockedActions(entry)
                ? ` ${clr.meta("(versions: " + fixPlan.blockedVersions.join(", ") + ")")}`
                : "";
            lines.push(
                `  ${clr.chrome("[override]")} ${clr.pkg(b.parent)}${clr.meta("@")}${clr.versionBad(b.parentVersion)} ${specDesc}${latestNote} — no update available${scopeNote}`,
            );
        }
    }

    // Prepend header with flag hint if needed
    if (lines.length > 0) {
        lines.unshift(`Actions:${flagHint}`);
    }

    // Append risk line
    if (riskLine) {
        lines.push(riskLine);
    }

    return lines;
}

/**
 * Render the compact analysis output for a single package.
 * Produces 1-4 lines depending on fix plan:
 *   Line 1: Package identity, severity, version gap
 *   Line 2: "Why" — root cause (only for blocked/workspace/mixed)
 *   Line 3: "↳ used by" — workspace roots (only if relevant)
 *   Line 4: "Fix" — actionable command + inline risk
 *
 * When --verbose is active, the full constraint/chain details follow.
 */
function formatPackageAnalysis(entry, whyData, pkgIndex, pkgTotal) {
    const { pkg, patched, severity, alertNums, ghsaIds } = entry;
    const progress = clr.meta(`[${pkgIndex}/${pkgTotal}]`);

    // ── Line 1: Identity ─────────────────────────────────────────────────
    if (!patched) {
        const noPatchVersions = getResolvedVersions(whyData);
        const installedStr =
            noPatchVersions.length > 0
                ? noPatchVersions.map((v) => clr.versionBad(v)).join(", ")
                : clr.meta("?");
        log(
            `\n  ${progress} \ud83d\udce6 ${clr.pkg.bold(pkg)} ${clr.fail("\u2717 no patch")} (${colorSeverity(severity)}) ${clr.meta("—")} installed: ${installedStr}, no fix published`,
        );
        return;
    }

    if (!entry.fixPlan) {
        log(
            `\n  ${progress} \ud83d\udce6 ${clr.pkg.bold(pkg)} ${clr.ok("\u2713 fixed")} (${colorSeverity(severity)}) ${clr.meta("—")} all installed versions \u2265${clr.versionOk(patched)}`,
        );
        return;
    }

    // For strategies that need action: show version gap
    const uniqueVersions = getResolvedVersions(whyData);
    const vulnVersions = uniqueVersions.filter((v) => semver.lt(v, patched));
    const versionGap = vulnVersions
        .map((v) => clr.versionBad(`\u2717 ${v}`))
        .join(", ");

    log(
        `\n  ${progress} \ud83d\udce6 ${clr.pkg.bold(pkg)} (${colorSeverity(severity)}) ${clr.meta("—")} ${versionGap} ${clr.meta("\u2192")} need ${clr.versionOk(`\u2265${patched}`)}`,
    );

    // ── Advisory IDs (verbose only) ──────────────────────────────────────
    if (VERBOSE) {
        const uniqueGhsaIds = [...new Set(ghsaIds)];
        if (uniqueGhsaIds.length > 0) {
            log(
                `     Advisories: ${uniqueGhsaIds.map((id) => clr.meta(id)).join(clr.meta(", "))}`,
            );
        }
    }

    // ── "Used by" — which workspace packages are affected ─────────────
    if (!isSimpleUpdate(entry)) {
        const wsRoots = extractWorkspaceRoots(whyData);
        if (wsRoots.length > 0) {
            const rootsStr =
                wsRoots
                    .slice(0, 4)
                    .map((r) => clr.root(r))
                    .join(clr.meta(", ")) +
                (wsRoots.length > 4
                    ? clr.meta(` +${wsRoots.length - 4} more`)
                    : "");
            log(`     ${clr.meta("↳ used by:")} ${rootsStr}`);
        }
    }

    // ── Actions: reason-centric fix steps + risk ─────────────────────────
    const actionLines = formatActions(entry);
    for (const line of actionLines) {
        log(`     ${line}`);
    }

    // ── Verbose: full constraint and chain details ───────────────────────
    if (VERBOSE && entry.fixPlan) {
        displayConstraints(entry.fixPlan.constraints, pkg);
    }
    if (SHOW_CHAINS) {
        fmtDepChain(whyData, pkg);
    }
}

/**
 * Populate fixPlan, blockingReasons, and overrideReasons on the entry.
 * Pure classification — no display output.
 */
function classifyWithFixPlan(entry, whyData) {
    const { pkg, patched } = entry;

    entry.fixPlan = planFixes(pkg, patched, whyData);

    if (hasUnblockedActions(entry)) {
        if (!flagAllows(UPDATE_PARENTS, pkg)) {
            entry.blockingReasons.push("--update-parents not specified");
        }
    }
    if (needsOverride(entry)) {
        entry.overrideReasons = [...entry.fixPlan.blockReasons];
        if (!flagAllows(APPLY_OVERRIDES, pkg)) {
            entry.blockingReasons.push("--apply-overrides not specified");
        }
    }
}

// ── Stage functions ──────────────────────────────────────────────────────────

/** Stage 1: Fetch open Dependabot alerts from GitHub. */
function fetchAlerts() {
    header("Fetching open Dependabot alerts from GitHub");

    let alerts;
    try {
        const remoteUrl = runCmd("git", ["remote", "get-url", "origin"]);
        const match = remoteUrl.match(
            /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/,
        );
        if (!match) {
            throw new Error(
                `Cannot parse GitHub owner/repo from remote: ${remoteUrl}`,
            );
        }
        const [, owner, repo] = match;
        log(`  Repository: ${clr.chrome(owner + "/" + repo)}`);

        const raw = runCmd("gh", [
            "api",
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/dependabot/alerts?state=open&per_page=100`,
            "--paginate",
        ]);

        alerts = parsePaginatedJson(raw);
    } catch (e) {
        console.error("Failed to fetch alerts:", e.message);
        console.error(
            "Make sure `gh` is installed, authenticated, and has access to Dependabot alerts.",
        );
        process.exit(1);
    }

    // Only npm ecosystem alerts
    alerts = alerts.filter((a) => a.dependency?.package?.ecosystem === "npm");

    if (alerts.length === 0) {
        log("  No open npm Dependabot alerts found. 🎉");
        process.exit(0);
    }

    return alerts;
}

/** Stage 2: Group alerts by vulnerable package, keeping the highest required patch version. */
function deduplicateAlerts(alerts) {
    const byPackage = new Map();
    for (const alert of alerts) {
        const pkg = alert.dependency.package.name;
        const patched =
            alert.security_vulnerability?.first_patched_version?.identifier;
        const severity = alert.security_advisory?.severity ?? "unknown";
        const ghsaId = alert.security_advisory?.ghsa_id ?? "";
        const manifest = alert.dependency?.manifest_path ?? "";

        if (!byPackage.has(pkg)) {
            byPackage.set(pkg, {
                package: pkg,
                patched,
                severity,
                alerts: [],
                ghsaIds: [],
                manifests: new Set(),
            });
        }
        const entry = byPackage.get(pkg);
        entry.alerts.push(alert.number);
        if (ghsaId) entry.ghsaIds.push(ghsaId);
        if (manifest) entry.manifests.add(manifest);

        // Keep the highest severity across all alerts for this package
        if (
            (SEVERITY_ORDER[severity] || 0) >
            (SEVERITY_ORDER[entry.severity] || 0)
        ) {
            entry.severity = severity;
        }

        if (
            patched &&
            semver.valid(patched) &&
            (!entry.patched ||
                !semver.valid(entry.patched) ||
                semver.compare(patched, entry.patched) > 0)
        ) {
            entry.patched = patched;
        }
    }

    // Sort by severity (critical first), then alphabetically by package name
    const sorted = new Map(
        [...byPackage.entries()].sort(([, a], [, b]) => {
            const sevDiff =
                (SEVERITY_ORDER[b.severity] || 0) -
                (SEVERITY_ORDER[a.severity] || 0);
            return sevDiff !== 0 ? sevDiff : a.package.localeCompare(b.package);
        }),
    );

    log(
        `  Found ${clr.warn.bold(alerts.length)} alert(s) across ${clr.chrome.bold(sorted.size)} package(s)`,
    );
    return sorted;
}

/** Stage 3: Classify each vulnerable package. */
function analyzeVulnerabilities(byPackage) {
    header("Analyzing vulnerabilities");

    const analyses = [];
    let pkgIndex = 0;
    const pkgTotal = byPackage.size;

    for (const [pkg, info] of byPackage) {
        pkgIndex++;
        const {
            patched,
            severity,
            alerts: alertNums,
            ghsaIds,
            manifests,
        } = info;
        const manifestList = [...manifests].join(", ");

        const entry = {
            pkg,
            patched,
            severity,
            alertNums,
            ghsaIds,
            manifestList,
            currentVersion: null,
            latestVersion: null,
            fixPlan: null,
            blockingReasons: [],
        };

        // Populate version data
        const whyData = getPnpmWhy(pkg);

        if (!patched) {
            const noPatchVersions = getResolvedVersions(whyData);
            entry.currentVersion =
                noPatchVersions.length > 0 ? noPatchVersions[0] : null;
        } else {
            const uniqueVersions = getResolvedVersions(whyData);
            const vulnVersions = uniqueVersions.filter((v) =>
                semver.lt(v, patched),
            );
            const fixedVersions = uniqueVersions.filter((v) =>
                semver.gte(v, patched),
            );
            entry.currentVersion =
                vulnVersions.length > 0
                    ? vulnVersions[0]
                    : fixedVersions[0] || null;
            entry.latestVersion = getLatestVersion(pkg);

            if (vulnVersions.length === 0) {
                // Already fixed — no fixPlan needed
            } else {
                // Show progress on stderr so the spinner appears under
                // the right package context (not glued to the previous entry)
                if (process.stderr.isTTY && !JSON_OUTPUT) {
                    process.stderr.write(
                        `\r\x1b[K\n  ${clr.meta(`[${pkgIndex}/${pkgTotal}]`)} ${clr.meta(`Analyzing ${pkg}…`)}`,
                    );
                }
                // Classify via tree-walk fix planner
                classifyWithFixPlan(entry, whyData);
                // Move cursor back up so formatPackageAnalysis output
                // overwrites the progress line cleanly
                if (process.stderr.isTTY && !JSON_OUTPUT) {
                    process.stderr.write(`\x1b[A\r\x1b[K`);
                }
            }
        }

        // Render compact output
        formatPackageAnalysis(entry, whyData, pkgIndex, pkgTotal);
        analyses.push(entry);
    }

    return analyses;
}

/** Stage 5: Execute resolutions. */
function executeResolutions(analyses) {
    const actionable = analyses.filter(
        (a) => a.fixPlan && a.blockingReasons.length === 0,
    );

    if (actionable.length > 0) {
        header(DRY_RUN ? "Resolution plan (dry run)" : "Applying resolutions");
    }

    const results = {
        alreadyFixed: analyses.filter((a) => a.patched && !a.fixPlan),
        resolved: [],
        blocked: analyses.filter((a) => a.blockingReasons.length > 0),
        noPatch: analyses.filter((a) => !a.patched),
        failed: [],
    };

    /**
     * Run `pnpm update <pkg> -r` and verify all versions are fixed.
     * Returns "ok" | "blocked" | "failed".
     */
    function runUpdateAndVerify(a) {
        try {
            tryRunCmd("pnpm", ["update", a.pkg, "-r"], {
                timeout: 120000,
            });
            const check = verifyAllVersionsFixed(a.pkg, a.patched);
            if (check.ok) {
                ok(
                    `Updated ${a.pkg} — all versions fixed: ${check.versions.join(", ")}`,
                );
                return "ok";
            }
            warn(
                `pnpm update left unfixed versions of ${a.pkg}: ${check.unfixed.join(", ")} (need >=${a.patched})`,
            );
            a.blockingReasons.push(
                `pnpm update left unfixed versions: ${check.unfixed.join(", ")}`,
            );
            return "blocked";
        } catch (e) {
            fail(`pnpm update failed for ${a.pkg}: ${e.message}`);
            a.error = e.message;
            return "failed";
        }
    }

    for (const a of actionable) {
        const dryTag = DRY_RUN ? clr.meta("[dry-run] ") : "";

        if (isSimpleUpdate(a)) {
            if (DRY_RUN) {
                ok(`${dryTag}pnpm update ${a.pkg} -r → >=${a.patched}`);
            } else {
                const outcome = runUpdateAndVerify(a);
                if (outcome === "blocked") {
                    results.blocked.push(a);
                    continue;
                }
                if (outcome === "failed") {
                    results.failed.push(a);
                    continue;
                }
            }
            results.resolved.push(a);
        } else if (hasUnblockedActions(a)) {
            const wsActions =
                a.fixPlan?.unblockedActions?.filter(
                    (act) => act.type === "update-workspace",
                ) || [];
            const intermediateActions =
                a.fixPlan?.unblockedActions?.filter(
                    (act) => act.type === "update-intermediate",
                ) || [];
            if (DRY_RUN) {
                for (const act of wsActions) {
                    ok(
                        `${dryTag}${act.workspace}: ${act.pkg} ${clr.versionBad(act.oldSpec)} \u2192 ${clr.versionOk(act.newSpec)}`,
                    );
                }
                for (const act of intermediateActions) {
                    ok(
                        `${dryTag}pnpm update ${act.pkg} -r (${clr.versionBad(act.fromVersion)} \u2192 ${clr.versionOk(act.toVersion)})`,
                    );
                }
                ok(`${dryTag}pnpm update ${a.pkg} -r → >=${a.patched}`);
                if (needsOverride(a)) {
                    ok(
                        `${dryTag}Add pnpm.overrides["${a.pkg}"] = ">=${a.patched}" (for blocked versions: ${a.fixPlan.blockedVersions.join(", ")})`,
                    );
                }
            } else {
                if (wsActions.length > 0) {
                    const applied = applyFixActions(wsActions);
                    if (applied === 0) {
                        warn(`No parent updates could be applied for ${a.pkg}`);
                    }
                }
                // Update intermediate packages first so their newer
                // versions widen the dep spec for the vulnerable package
                if (intermediateActions.length > 0) {
                    const intermediatePkgs = [
                        ...new Set(intermediateActions.map((act) => act.pkg)),
                    ];
                    verbose(
                        `Updating intermediates: ${intermediatePkgs.join(", ")}`,
                    );
                    tryRunCmd("pnpm", ["update", ...intermediatePkgs, "-r"], {
                        timeout: 120000,
                    });
                }
                // Run pnpm update to fix the unblocked subtrees
                const outcome = runUpdateAndVerify(a);
                if (outcome === "ok") {
                    // pnpm update fixed everything (including blocked subtrees
                    // that may have resolved anyway) — no override needed
                } else if (outcome === "failed") {
                    results.failed.push(a);
                    continue;
                } else if (needsOverride(a)) {
                    // Expected: blocked versions remain — override handles them
                    a.blockingReasons.length = 0; // clear; override will fix
                } else {
                    // workspace actions but update didn't fully resolve
                    results.blocked.push(a);
                    continue;
                }
            }
            results.resolved.push(a);
        } else if (needsOverride(a)) {
            if (DRY_RUN) {
                ok(
                    `${dryTag}Add pnpm.overrides["${a.pkg}"] = ">=${a.patched}"`,
                );
            }
            // Overrides are batched and written after the loop
            results.resolved.push(a);
        }
    }

    // Batch-write all override entries in a single read/write cycle
    if (!DRY_RUN) {
        const pendingOverrides = new Map();
        for (const a of results.resolved) {
            if (needsOverride(a)) {
                pendingOverrides.set(a.pkg, `>=${a.patched}`);
            }
        }
        if (pendingOverrides.size > 0) {
            try {
                addOverrides(pendingOverrides);
                for (const [pkg, spec] of pendingOverrides) {
                    ok(`Added pnpm.overrides["${pkg}"] = "${spec}"`);
                }
            } catch (e) {
                fail(`Failed to write overrides: ${e.message}`);
                // Move all override entries to failed
                results.resolved = results.resolved.filter((a) => {
                    if (needsOverride(a)) {
                        a.error = e.message;
                        results.failed.push(a);
                        return false;
                    }
                    return true;
                });
            }
        }
    }

    // If overrides were added, run pnpm install to apply them
    if (!DRY_RUN) {
        const needsInstall = results.resolved.some((a) => needsOverride(a));
        if (needsInstall) {
            log("");
            try {
                runCmd("pnpm", ["install"], { timeout: 300000 });
                ok("pnpm install completed successfully");
            } catch (e) {
                fail(`pnpm install failed: ${e.message}`);
            }
        }
    }

    return results;
}

/**
 * Derive a summary action tag from the entry's actual fix plan actions,
 * e.g. "[workspace+update]", "[update+override]", "[override]".
 */
function formatActionTag(entry) {
    const parts = [];
    const actions = entry.fixPlan?.unblockedActions || [];
    if (actions.some((a) => a.type === "update-workspace")) {
        parts.push("workspace");
    }
    if (
        isSimpleUpdate(entry) ||
        actions.some((a) => a.type === "update-intermediate")
    ) {
        parts.push("update");
    }
    if (needsOverride(entry)) {
        parts.push("override");
    }
    return `[${parts.join("+")}]`;
}

/** Stage 6: Print summary and set exit code. */
function printSummary(results) {
    header("Summary");

    const summaryParts = [
        results.alreadyFixed.length > 0 &&
            clr.ok(results.alreadyFixed.length + " already fixed"),
        results.resolved.length > 0 &&
            clr.ok(
                results.resolved.length +
                    (DRY_RUN ? " to resolve" : " resolved"),
            ),
        results.blocked.length > 0 &&
            clr.warn(results.blocked.length + " blocked"),
        results.noPatch.length > 0 &&
            clr.fail(results.noPatch.length + " no fix available"),
        results.failed.length > 0 &&
            clr.fail(results.failed.length + " failed"),
    ].filter(Boolean);
    if (summaryParts.length > 0) {
        log(`\n  ${summaryParts.join(" | ")}`);
    }

    if (results.blocked.length > 0) {
        log("");
        const parentBlocked = results.blocked.filter(
            (a) => hasUnblockedActions(a) && !needsOverride(a),
        );
        const overrideBlocked = results.blocked.filter(
            (a) =>
                needsOverride(a) &&
                a.blockingReasons.some(
                    (r) =>
                        r === "--apply-overrides not specified" ||
                        r === "--update-parents not specified",
                ),
        );
        const unfixable = results.blocked.filter(
            (a) =>
                !hasUnblockedActions(a) &&
                !a.blockingReasons.some(
                    (r) => r === "--apply-overrides not specified",
                ),
        );

        if (parentBlocked.length > 0 || overrideBlocked.length > 0) {
            const autoFixPkgs = [
                ...parentBlocked.map((a) => a.pkg),
                ...overrideBlocked.map((a) => a.pkg),
            ];
            log(
                `  Run with ${clr.chrome("--auto-fix")} to fix: ${autoFixPkgs.map((p) => clr.pkg(p)).join(", ")}`,
            );
            if (parentBlocked.length > 0) {
                const parentDetails = parentBlocked.map((a) => {
                    const updatedPkgs = a.fixPlan?.unblockedActions
                        ?.filter((act) => act.type === "update-workspace")
                        .map((act) => act.pkg);
                    const via =
                        updatedPkgs?.length > 0
                            ? ` ${clr.meta("via")} ${updatedPkgs.map((p) => clr.pkg(p)).join(", ")}`
                            : "";
                    return `${clr.pkg(a.pkg)}${via}`;
                });
                log(
                    `    (or ${clr.chrome("--update-parents")} for: ${parentDetails.join("; ")})`,
                );
            }
            if (overrideBlocked.length > 0) {
                log(
                    `    (or ${clr.chrome("--apply-overrides")} for: ${overrideBlocked.map((a) => clr.pkg(a.pkg)).join(", ")})`,
                );
            }
        }
        if (unfixable.length > 0) {
            log(clr.warn(`\n  Packages with no automated fix:`));
            for (const a of unfixable) {
                const reasons = a.blockingReasons.filter(
                    (r) => r !== "--apply-overrides not specified",
                );
                log(`     ${clr.pkg(a.pkg)}: ${clr.meta(reasons.join("; "))}`);
            }
        }

        if (!SHOW_CHAINS) {
            log(
                `\n  Run with ${clr.chrome("--show-chains")} to see full dependency paths for blocked packages.`,
            );
        }
    }

    // Fixed packages — show what was resolved instead of risk
    const fixedEntries = results.resolved.filter((a) => a.fixPlan);
    if (fixedEntries.length > 0) {
        log(clr.meta(`\n  Fixed packages:`));
        for (const a of fixedEntries) {
            const strategyTag = clr.chrome(formatActionTag(a));
            const fromVer = a.currentVersion
                ? `${clr.meta(a.currentVersion)} ${clr.meta("→")} `
                : "";
            log(
                `     ${clr.ok("✓")}  ${strategyTag} ${clr.pkg(a.pkg)} ${fromVer}${clr.versionOk(`>=${a.patched}`)}`,
            );
        }
    }

    // Risk assessment for blocked entries only (resolved ones shown above)
    const RISK_ORDER = { high: 0, medium: 1, low: 2 };
    const riskEntries = results.blocked.filter((a) => a.fixPlan);
    if (riskEntries.length > 0) {
        const assessed = riskEntries.map((a) => ({
            entry: a,
            risk: assessRisk(a),
        }));
        assessed.sort((a, b) => {
            const riskDiff =
                (RISK_ORDER[a.risk.level] ?? 3) -
                (RISK_ORDER[b.risk.level] ?? 3);
            if (riskDiff !== 0) return riskDiff;
            // Secondary: override > workspace > update
            const ACTION_ORDER = { override: 0, workspace: 1, update: 2 };
            const aTag = formatActionTag(a.entry);
            const bTag = formatActionTag(b.entry);
            const aAction = aTag.includes("override")
                ? "override"
                : aTag.includes("workspace")
                  ? "workspace"
                  : "update";
            const bAction = bTag.includes("override")
                ? "override"
                : bTag.includes("workspace")
                  ? "workspace"
                  : "update";
            return (ACTION_ORDER[aAction] ?? 3) - (ACTION_ORDER[bAction] ?? 3);
        });
        log(clr.meta(`\n  Risk assessment:`));
        for (const { entry: a, risk } of assessed) {
            const riskIcon =
                risk.level === "high"
                    ? clr.fail("▲ high")
                    : risk.level === "medium"
                      ? clr.warn("■ medium")
                      : clr.ok("▽ low");
            const strategyTag = clr.chrome(formatActionTag(a));
            log(
                `     ${riskIcon}  ${strategyTag} ${clr.pkg(a.pkg)} ${clr.versionOk(`>=${a.patched}`)}: ${clr.meta(risk.reason)}`,
            );
        }
    }

    if (DRY_RUN) {
        log(clr.meta("\n  ℹ  This was a dry run. No changes were made."));
    }

    log("");

    if (
        results.blocked.length > 0 ||
        results.noPatch.length > 0 ||
        results.failed.length > 0
    ) {
        process.exit(1);
    }
}

/**
 * Check existing pnpm.overrides and remove entries whose override version
 * is already satisfied by the naturally resolved version.
 */
function pruneOverrides() {
    header("Pruning stale pnpm.overrides");

    const pkgJsonPath = resolve(ROOT, "package.json");
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));

    const overrides = pkgJson.pnpm?.overrides;
    if (!overrides || Object.keys(overrides).length === 0) {
        ok("No pnpm.overrides found — nothing to prune");
        return;
    }

    log(
        `  Found ${clr.chrome.bold(Object.keys(overrides).length)} override(s)`,
    );
    const toRemove = [];

    for (const [pkg, spec] of Object.entries(overrides)) {
        // Check if the package is still in the dependency tree
        const whyData = getPnpmWhy(pkg);
        if (whyData.length === 0) {
            log(
                `     ${clr.pkg(pkg)}: ${clr.meta("not installed — keeping override")}`,
            );
            continue;
        }
        const parents = findConstrainingParentsFromData(whyData, pkg);

        // Parse the minimum version from the override spec
        const minVersion = semver.minVersion(spec);
        if (!minVersion) {
            log(
                `     ${clr.pkg(pkg)}: ${clr.meta(`cannot parse spec "${spec}" — keeping`)}`,
            );
            continue;
        }

        const allAllow =
            parents.length === 0 ||
            parents.every(
                (cp) =>
                    cp.requiredSpec &&
                    specGuaranteesMinVersion(
                        cp.requiredSpec,
                        minVersion.version,
                    ),
            );

        if (allAllow) {
            ok(
                `${pkg}: override "${spec}" no longer needed (parents allow ${minVersion.version})`,
            );
            toRemove.push(pkg);
        } else {
            log(
                `     ${clr.pkg(pkg)}: ${clr.warn("still needed")} — parents don't allow ${minVersion.version}`,
            );
        }
    }

    if (toRemove.length === 0) {
        log(`\n  All overrides are still needed.`);
        return;
    }

    if (DRY_RUN) {
        log(
            clr.meta(
                `\n  ℹ  Would remove ${toRemove.length} override(s). Run without --dry-run to apply.`,
            ),
        );
        return;
    }

    for (const pkg of toRemove) {
        delete pkgJson.pnpm.overrides[pkg];
    }
    if (Object.keys(pkgJson.pnpm.overrides).length === 0) {
        delete pkgJson.pnpm.overrides;
    }
    if (Object.keys(pkgJson.pnpm).length === 0) {
        delete pkgJson.pnpm;
    }

    writeFileSync(
        pkgJsonPath,
        JSON.stringify(pkgJson, null, 2) + "\n",
        "utf-8",
    );
    ok(`Removed ${toRemove.length} stale override(s)`);
}

/**
 * Emit JSON output for CI integration.
 */
function emitJson(results) {
    const toJson = (a) => ({
        package: a.pkg,
        severity: a.severity,
        alertNumbers: a.alertNums,
        ghsaIds: a.ghsaIds,
        currentVersion: a.currentVersion,
        patchedVersion: a.patched,
        latestVersion: a.latestVersion,
        blockingReasons: a.blockingReasons,
    });

    const output = {
        summary: {
            alreadyFixed: results.alreadyFixed.length,
            resolved: results.resolved.length,
            blocked: results.blocked.length,
            noPatch: results.noPatch.length,
            failed: results.failed.length,
        },
        dryRun: DRY_RUN,
        alreadyFixed: results.alreadyFixed.map(toJson),
        resolved: results.resolved.map(toJson),
        blocked: results.blocked.map(toJson),
        noPatch: results.noPatch.map(toJson),
        failed: results.failed.map(toJson),
    };

    console.log(JSON.stringify(output, null, 2));
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
    if (PRUNE_OVERRIDES) {
        pruneOverrides();
        return;
    }

    const alerts = fetchAlerts();
    const byPackage = deduplicateAlerts(alerts);
    const analyses = analyzeVulnerabilities(byPackage);
    const results = executeResolutions(analyses);

    if (JSON_OUTPUT) {
        emitJson(results);
    } else {
        printSummary(results);
    }
}

main();
