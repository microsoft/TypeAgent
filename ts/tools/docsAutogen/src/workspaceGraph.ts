// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs/promises";
import { glob } from "node:fs/promises";
import path from "node:path";

/**
 * A workspace package as identified from disk.
 */
export interface WorkspacePackage {
    /** Value of `name` in package.json. */
    readonly name: string;
    /** Absolute path of the package directory. */
    readonly dir: string;
    /** POSIX-style path of `dir` relative to the monorepo root. */
    readonly relDir: string;
    /** Parsed package.json. */
    readonly packageJson: PackageJson;
    /** True when `private: true` in package.json. */
    readonly isPrivate: boolean;
}

/**
 * Loose `package.json` shape — only the fields we actually inspect.
 */
export interface PackageJson {
    name?: string;
    version?: string;
    description?: string;
    private?: boolean;
    main?: string;
    exports?: unknown;
    bin?: unknown;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    [k: string]: unknown;
}

/**
 * Result of building the dependency / reverse-dependency graph over a
 * set of workspace packages.
 */
export interface WorkspaceGraph {
    /** Lookup by package name. */
    readonly byName: ReadonlyMap<string, WorkspacePackage>;
    /** name -> set of workspace dep names this package depends on. */
    readonly deps: ReadonlyMap<string, ReadonlySet<string>>;
    /** name -> set of workspace dep names that depend on this package. */
    readonly reverseDeps: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Parse the very small subset of `pnpm-workspace.yaml` we need: the
 * `packages:` list. We deliberately avoid pulling in a YAML dep — the
 * file format is well-known and stable in this repo.
 */
export function parseWorkspacePatterns(yamlText: string): string[] {
    const lines = yamlText.split(/\r?\n/u);
    const patterns: string[] = [];
    let inPackages = false;
    for (const raw of lines) {
        const line = raw.replace(/#.*$/u, "");
        if (/^packages\s*:/u.test(line)) {
            inPackages = true;
            continue;
        }
        if (inPackages) {
            const m = /^\s*-\s*"?([^"\s][^"]*?)"?\s*$/u.exec(line);
            if (m && m[1]) {
                patterns.push(m[1]);
                continue;
            }
            // A new top-level key terminates the packages block.
            if (/^[A-Za-z_]/u.test(line)) {
                inPackages = false;
            }
        }
    }
    return patterns;
}

/**
 * Patterns that should never be treated as workspace packages even if
 * they live under a matching glob.
 */
const ALWAYS_EXCLUDED_DIRS = new Set<string>([
    // Private submodule that is not yet part of the public repo.
    "SecretAgents",
]);

/**
 * Scan the monorepo and return every workspace package, deduplicated
 * by directory.
 *
 * @param monorepoRoot Absolute path of the directory containing
 *   `pnpm-workspace.yaml`.
 */
export async function loadWorkspaceFromDisk(
    monorepoRoot: string,
): Promise<WorkspacePackage[]> {
    const yamlPath = path.join(monorepoRoot, "pnpm-workspace.yaml");
    const yamlText = await fs.readFile(yamlPath, "utf8");
    const patterns = parseWorkspacePatterns(yamlText);

    const seen = new Map<string, WorkspacePackage>();
    for (const pattern of patterns) {
        if (containsExcluded(pattern)) continue;
        const expanded = await expandPattern(monorepoRoot, pattern);
        for (const dir of expanded) {
            if (seen.has(dir)) continue;
            const pkgJsonPath = path.join(dir, "package.json");
            let pkgJsonText: string;
            try {
                pkgJsonText = await fs.readFile(pkgJsonPath, "utf8");
            } catch {
                continue;
            }
            let pkgJson: PackageJson;
            try {
                pkgJson = JSON.parse(pkgJsonText) as PackageJson;
            } catch {
                continue;
            }
            if (typeof pkgJson.name !== "string") continue;
            const relDir = path
                .relative(monorepoRoot, dir)
                .split(path.sep)
                .join("/");
            seen.set(dir, {
                name: pkgJson.name,
                dir,
                relDir,
                packageJson: pkgJson,
                isPrivate: pkgJson.private === true,
            });
        }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function containsExcluded(pattern: string): boolean {
    const segments = pattern.split("/");
    return segments.some((seg) => ALWAYS_EXCLUDED_DIRS.has(seg));
}

async function expandPattern(root: string, pattern: string): Promise<string[]> {
    // The patterns in pnpm-workspace.yaml point at directories, but
    // node:fs/promises#glob primarily yields files. We glob for
    // `<pattern>/package.json` and take the parent directory of each
    // match — that also filters to "directories that are real packages".
    const dirs: string[] = [];
    const globPattern = `${pattern.replace(/\/+$/u, "")}/package.json`;
    try {
        for await (const match of glob(globPattern, { cwd: root })) {
            const abs = path.resolve(root, match);
            if (containsExcludedSegment(abs, root)) continue;
            dirs.push(path.dirname(abs));
        }
    } catch {
        // glob() throws if the pattern matches nothing on some Node
        // versions; treat as empty.
    }
    return dirs;
}

function containsExcludedSegment(absPath: string, root: string): boolean {
    const rel = path.relative(root, absPath);
    return rel.split(path.sep).some((seg) => ALWAYS_EXCLUDED_DIRS.has(seg));
}

const WORKSPACE_PROTOCOL = /^workspace:/u;

/**
 * Build forward and reverse dependency graphs over a set of workspace
 * packages. Only `workspace:*`-protocol references are followed —
 * external (registry) deps are ignored.
 *
 * Pure function: takes a list of packages, returns the graph. No I/O.
 */
export function buildGraph(
    packages: readonly WorkspacePackage[],
): WorkspaceGraph {
    const byName = new Map<string, WorkspacePackage>();
    for (const pkg of packages) {
        byName.set(pkg.name, pkg);
    }

    const deps = new Map<string, Set<string>>();
    const reverseDeps = new Map<string, Set<string>>();
    for (const pkg of packages) {
        deps.set(pkg.name, new Set<string>());
        reverseDeps.set(pkg.name, new Set<string>());
    }

    for (const pkg of packages) {
        const allDeps = collectDeps(pkg.packageJson);
        for (const [depName, version] of allDeps) {
            if (!WORKSPACE_PROTOCOL.test(version)) continue;
            if (!byName.has(depName)) continue;
            if (depName === pkg.name) continue;
            deps.get(pkg.name)!.add(depName);
            reverseDeps.get(depName)!.add(pkg.name);
        }
    }

    return { byName, deps, reverseDeps };
}

function collectDeps(pj: PackageJson): Map<string, string> {
    const all = new Map<string, string>();
    for (const field of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ] as const) {
        const block = pj[field];
        if (!block || typeof block !== "object") continue;
        for (const [name, version] of Object.entries(
            block as Record<string, string>,
        )) {
            // `dependencies` wins when a name appears in multiple
            // sections; we only care that *some* edge exists.
            if (!all.has(name)) {
                all.set(name, version);
            }
        }
    }
    return all;
}
