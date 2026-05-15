// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs/promises";
import path from "node:path";
import { detectAgentSurface, type AgentSurface } from "./agentSurface.js";
import { findAutogenRegion } from "./autogenRegion.js";
import { detectEnvVars } from "./detectEnvVars.js";
import {
    detectImplementedActionNames,
    extractActionsFromSchema,
    markImplementedActions,
    type AgentAction,
} from "./extractActions.js";
import { readReadmeContext, type ReadmeContext } from "./readReadmeContext.js";
import type {
    PackageJson,
    WorkspaceGraph,
    WorkspacePackage,
} from "./workspaceGraph.js";

/**
 * One source file inside a package, with cheap metadata.
 */
export interface SourceFile {
    /** POSIX path relative to the package root, with `./src/` prefix. */
    readonly relPath: string;
    /** Absolute path. */
    readonly absPath: string;
    /** Size in bytes. */
    readonly sizeBytes: number;
    /** Approximate line count (counted as `\n` occurrences + 1). */
    readonly lineCount: number;
}

/**
 * The classification of an entry-point export.
 */
export interface EntryPoint {
    /** Subpath under the package's `exports` map, e.g. `.` or `./agent/handlers`. */
    readonly subpath: string;
    /** Resolved POSIX path from `exports[subpath]`, with `./` prefix. */
    readonly resolved: string;
    /** True when the resolved file exists on disk. */
    readonly exists: boolean;
}

/**
 * Everything the renderer needs to produce an AUTOGEN block for a
 * single package. Gathered from disk + workspace graph; no LLM yet.
 */
export interface PackageInputs {
    readonly pkg: WorkspacePackage;
    /** Resolved value of `package.json#description`. */
    readonly description: string;
    /** Workspace packages this one depends on, sorted by name. */
    readonly workspaceDeps: WorkspacePackage[];
    /** External (npm) dependency names, sorted. */
    readonly externalDeps: string[];
    /** Workspace packages that depend on this one, sorted by name. */
    readonly reverseDeps: WorkspacePackage[];
    /** Source files under `src/`, capped to the largest interesting set. */
    readonly sourceFiles: SourceFile[];
    /** Total tracked source line count across `src/` (uncapped). */
    readonly totalSourceLines: number;
    /** Public entry points derived from `package.json#exports` / `main`. */
    readonly entryPoints: EntryPoint[];
    /** Detected agent surface, only meaningful for `packages/agents/**`. */
    readonly agentSurface: AgentSurface;
    /** True when the package lives under `packages/agents/**`. */
    readonly isAgentPackage: boolean;
    /**
     * Agent actions parsed from `*Schema.ts`. Empty when the package
     * is not an agent or the schema file is missing/unparseable.
     */
    readonly actions: readonly AgentAction[];
    /**
     * Project-specific environment variables referenced as
     * `process.env.<NAME>` anywhere in `src/` (excluding test/spec
     * files). System and runtime env vars (NODE_ENV, DEBUG, PATH, …)
     * are filtered out so this list reflects what a contributor would
     * actually need to configure. Sorted alphabetically.
     */
    readonly envVars: readonly string[];
    /**
     * Snapshot of the package's hand-written `README.md`, with the
     * AUTOGEN region (if any) and `## Trademarks` boilerplate
     * stripped. Fed to the LLM as authoritative source material.
     */
    readonly readmeContext: ReadmeContext;
    /**
     * Body of the existing AUTOGEN block inside `README.AUTOGEN.md`,
     * when present. Used by the renderer to preserve any LLM-friendly
     * legacy output across runs.
     */
    readonly existingBlock: string | null;
}

/**
 * Hard limits applied during input gathering (separate from the
 * length caps applied during rendering — these prevent the file
 * walker from doing pathological work on huge packages).
 */
const SOURCE_FILES_HARD_LIMIT = 500;
const SOURCE_LINE_COUNT_HARD_LIMIT = 200_000;

/**
 * Gather everything needed to render docs for a single package.
 */
export async function gatherPackageInputs(
    pkg: WorkspacePackage,
    graph: WorkspaceGraph,
    monorepoRoot: string,
): Promise<PackageInputs> {
    const description =
        typeof pkg.packageJson.description === "string"
            ? pkg.packageJson.description.trim()
            : "";

    const workspaceDeps = [...(graph.deps.get(pkg.name) ?? [])]
        .map((name) => graph.byName.get(name))
        .filter((p): p is WorkspacePackage => p !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name));

    const externalDeps = collectExternalDeps(pkg.packageJson, graph);

    const reverseDeps = [...(graph.reverseDeps.get(pkg.name) ?? [])]
        .map((name) => graph.byName.get(name))
        .filter((p): p is WorkspacePackage => p !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name));

    const { files, totalLines } = await walkSrc(pkg.dir);

    const entryPoints = await resolveEntryPoints(pkg);

    const agentSurface = await detectAgentSurface(pkg.dir);
    const isAgentPackage = pkg.relDir.startsWith("packages/agents/");

    let actions: AgentAction[] = [];
    if (isAgentPackage && agentSurface.schemaPath !== null) {
        const schemaAbs = path.join(pkg.dir, agentSurface.schemaPath);
        actions = await extractActionsFromSchema(schemaAbs);
        if (actions.length > 0 && agentSurface.handlerPath !== null) {
            const handlerAbs = path.join(pkg.dir, agentSurface.handlerPath);
            const implementedNames = await detectImplementedActionNames(
                handlerAbs,
                actions.map((a) => a.actionName),
            );
            actions = markImplementedActions(actions, implementedNames);
        }
    }

    const readmeContext = await readReadmeContext(pkg.dir);

    const existingBlock = await readExistingAutogenBody(pkg.dir);

    const envVars = await detectEnvVars(files);

    void monorepoRoot; // currently unused but reserved for cross-package link rendering
    return {
        pkg,
        description,
        workspaceDeps,
        externalDeps,
        reverseDeps,
        sourceFiles: files,
        totalSourceLines: totalLines,
        entryPoints,
        agentSurface,
        isAgentPackage,
        actions,
        envVars,
        readmeContext,
        existingBlock,
    };
}

function collectExternalDeps(pj: PackageJson, graph: WorkspaceGraph): string[] {
    const seen = new Set<string>();
    for (const field of [
        "dependencies",
        "peerDependencies",
        "optionalDependencies",
    ] as const) {
        const block = pj[field];
        if (!block || typeof block !== "object") continue;
        for (const [name, version] of Object.entries(
            block as Record<string, string>,
        )) {
            if (typeof version !== "string") continue;
            if (version.startsWith("workspace:")) continue;
            if (graph.byName.has(name)) continue;
            seen.add(name);
        }
    }
    return [...seen].sort();
}

async function walkSrc(packageDir: string): Promise<{
    files: SourceFile[];
    totalLines: number;
}> {
    const srcDir = path.join(packageDir, "src");
    const files: SourceFile[] = [];
    let totalLines = 0;
    try {
        await walk(srcDir, srcDir, files);
    } catch {
        return { files: [], totalLines: 0 };
    }
    files.sort((a, b) => a.relPath.localeCompare(b.relPath));
    for (const f of files) {
        totalLines += f.lineCount;
        if (totalLines > SOURCE_LINE_COUNT_HARD_LIMIT) break;
    }
    return { files, totalLines };
}

async function walk(
    base: string,
    dir: string,
    out: SourceFile[],
): Promise<void> {
    if (out.length >= SOURCE_FILES_HARD_LIMIT) return;
    let entries: import("node:fs").Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === "dist")
                continue;
            await walk(base, abs, out);
        } else if (entry.isFile()) {
            if (out.length >= SOURCE_FILES_HARD_LIMIT) return;
            const stat = await fs.stat(abs);
            const relFromBase = path
                .relative(base, abs)
                .split(path.sep)
                .join("/");
            const relPath = `./src/${relFromBase}`;
            const lineCount = await countLines(abs);
            out.push({
                relPath,
                absPath: abs,
                sizeBytes: stat.size,
                lineCount,
            });
        }
    }
}

async function countLines(absPath: string): Promise<number> {
    try {
        const content = await fs.readFile(absPath, "utf8");
        if (content.length === 0) return 0;
        let count = 1;
        for (const ch of content) if (ch === "\n") count++;
        return count;
    } catch {
        return 0;
    }
}

async function resolveEntryPoints(
    pkg: WorkspacePackage,
): Promise<EntryPoint[]> {
    const out: EntryPoint[] = [];
    const seen = new Set<string>();
    const exportsField = pkg.packageJson.exports;
    if (
        exportsField !== undefined &&
        exportsField !== null &&
        typeof exportsField === "object"
    ) {
        for (const [subpath, value] of Object.entries(
            exportsField as Record<string, unknown>,
        )) {
            const targets = collectExportTargets(value);
            for (const target of targets) {
                const normalized = normalizeRelative(target);
                if (normalized === null) continue;
                const key = `${subpath}|${normalized}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({
                    subpath,
                    resolved: normalized,
                    exists: await pathExists(path.join(pkg.dir, normalized)),
                });
            }
        }
    }
    if (out.length === 0 && typeof pkg.packageJson.main === "string") {
        const normalized = normalizeRelative(pkg.packageJson.main);
        if (normalized !== null) {
            out.push({
                subpath: ".",
                resolved: normalized,
                exists: await pathExists(path.join(pkg.dir, normalized)),
            });
        }
    }
    return out;
}

function collectExportTargets(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (value === null || typeof value !== "object") return [];
    const out: string[] = [];
    for (const v of Object.values(value as Record<string, unknown>)) {
        out.push(...collectExportTargets(v));
    }
    return out;
}

function normalizeRelative(p: string): string | null {
    if (typeof p !== "string" || p.length === 0) return null;
    const trimmed = p.split("\\").join("/");
    if (trimmed.startsWith("./") || trimmed.startsWith("../")) return trimmed;
    if (trimmed.startsWith("/")) return `.${trimmed}`;
    return `./${trimmed}`;
}

async function pathExists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

async function readExistingAutogenBody(
    packageDir: string,
): Promise<string | null> {
    // The pivot to README.AUTOGEN.md (Phase 5) means the AUTOGEN
    // region now lives in its own file. Fall back to README.md only
    // for backward compatibility while migrating older packages whose
    // AUTOGEN block is still embedded in their README.md.
    for (const fileName of ["README.AUTOGEN.md", "README.md"] as const) {
        const candidate = path.join(packageDir, fileName);
        let content: string;
        try {
            content = await fs.readFile(candidate, "utf8");
        } catch {
            continue;
        }
        try {
            const region = findAutogenRegion(content);
            if (region !== null) return region.body;
        } catch {
            // Malformed markers in this file; try the next one.
        }
    }
    return null;
}
