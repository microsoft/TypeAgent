// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Repository-backed grammar collision scanner.
 *
 * Bridges the framework-agnostic NFA collision engine in `grammar-tools-core`
 * to the Studio collision store: it discovers each agent's compiled grammar
 * (`*.ag.json`) under `packages/agents/<name>`, runs the pairwise overlap
 * scan, and returns the detected collisions in the `GrammarToolCollisionLike`
 * shape the `CollisionService.fromGrammarTools` mapper consumes.
 *
 * Kept out of `collisions/index.ts` (and behind the dedicated
 * `@typeagent/core/collisionScanner` export) so importing the lightweight
 * collision service/types does not pull the heavier `action-grammar` engine.
 */

import path from "node:path";
import type { Dirent } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { grammarFromJson, registerBuiltInEntities } from "action-grammar";
import {
    scanGrammarCollisions,
    type CollisionRecord,
    type SchemaInput,
} from "grammar-tools-core";
import {
    resolveAgentPackageDir,
    resolveAgentRoots,
    type AgentRootsInput,
} from "../health/index.js";
import type { GrammarToolCollisionLike } from "./types.js";

export interface GrammarScanRequest {
    /** Agent package names to scan (under `packages/agents/<name>`). */
    agents: string[];
}

export interface GrammarScanSkip {
    schemaName: string;
    /** Owning agent package, when the schema is a sub-schema of an agent. */
    agentName?: string;
    reason:
        | "no-grammar"
        | "grammar-not-built"
        | "parse-error"
        | "compile-error";
    /**
     * For `grammar-not-built`: whether the agent has a grammar-compile script
     * (`agc` / `agc:all`) so the grammar can actually be built. When false, the
     * agent ships `.agr` source with no build step to compile it.
     */
    compilable?: boolean;
    error?: string;
}

export interface RawGrammarScanReport {
    /** Schema names that compiled and participated in pairwise checks. */
    scanned: string[];
    /** Agents/schemas skipped, with reasons. */
    skipped: GrammarScanSkip[];
    /** Detected cross-schema collisions in grammar-tools raw shape. */
    collisions: GrammarToolCollisionLike[];
}

/**
 * Scans a set of agents for cross-schema grammar collisions. Injected into the
 * Studio runtime so tests can substitute a deterministic stub.
 */
export type GrammarCollisionScanner = (
    request: GrammarScanRequest,
) => Promise<RawGrammarScanReport>;

export interface RepoGrammarScannerOptions {
    /** Repository root that contains `packages/agents/<name>`. */
    repoRoot: string;
    /**
     * Ordered directories that contain agent subdirectories (each peer to
     * `packages/agents`). Defaults to `[<repoRoot>/packages/agents]`. May be a
     * provider so configuration changes are picked up without reconstruction.
     * An agent is resolved by probing each root.
     */
    agentRoots?: AgentRootsInput;
}

/**
 * Derive the dispatcher-aligned schema name from a compiled grammar file:
 * basename minus the `.ag.json` extension and any trailing `Schema` suffix the
 * grammar generator appends.
 */
export function schemaNameFromGrammarFile(file: string): string {
    const base = path.basename(file).replace(/\.ag\.json$/i, "");
    return base.endsWith("Schema") ? base.slice(0, -"Schema".length) : base;
}

/**
 * Default filesystem-backed scanner: reads each agent's compiled grammars from
 * disk and runs the shared NFA overlap engine.
 */
export function createRepoGrammarScanner(
    options: RepoGrammarScannerOptions,
): GrammarCollisionScanner {
    const { repoRoot } = options;
    let entitiesRegistered = false;

    return async ({ agents }) => {
        if (!entitiesRegistered) {
            registerBuiltInEntities();
            entitiesRegistered = true;
        }
        const agentRoots = resolveAgentRoots(options.agentRoots, repoRoot);

        const inputs: SchemaInput[] = [];
        const skipped: GrammarScanSkip[] = [];
        const seen = new Set<string>();
        const fileBySchema = new Map<string, string>();
        const agentBySchema = new Map<string, string>();

        for (const agent of agents) {
            const packageDir = await resolveAgentPackageDir(agentRoots, agent);
            const compiled = await findFilesWithSuffix(packageDir, ".ag.json");
            if (compiled.length === 0) {
                // Distinguish "no grammar by design" (chat-style agents with no
                // .agr sources) from "grammar source exists but isn't built".
                // For the latter, also report whether a grammar-compile script
                // exists so the UI only offers a build when one can succeed.
                const hasSource =
                    (await findFilesWithSuffix(packageDir, ".agr")).length > 0;
                if (!hasSource) {
                    skipped.push({
                        schemaName: agent,
                        agentName: agent,
                        reason: "no-grammar",
                    });
                } else {
                    skipped.push({
                        schemaName: agent,
                        agentName: agent,
                        reason: "grammar-not-built",
                        compilable: await hasGrammarCompileScript(packageDir),
                    });
                }
                continue;
            }
            for (const file of compiled) {
                const schemaName = schemaNameFromGrammarFile(file);
                if (seen.has(schemaName)) {
                    continue;
                }
                seen.add(schemaName);
                agentBySchema.set(schemaName, agent);
                try {
                    const grammar = grammarFromJson(
                        JSON.parse(await readFile(file, "utf8")),
                    );
                    inputs.push({ schemaName, agentName: agent, grammar });
                    fileBySchema.set(
                        schemaName,
                        await resolveGrammarSource(file),
                    );
                } catch (err) {
                    skipped.push({
                        schemaName,
                        agentName: agent,
                        reason: "parse-error",
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        }

        const result = scanGrammarCollisions(inputs);

        for (const skip of result.skipped) {
            const agentName = agentBySchema.get(skip.schemaName);
            skipped.push({
                schemaName: skip.schemaName,
                ...(agentName !== undefined ? { agentName } : {}),
                reason: skip.reason,
                error: skip.error,
            });
        }

        return {
            scanned: Object.keys(result.schemas),
            skipped,
            collisions: Object.values(result.collisions).map((record) =>
                mapRecord(record, fileBySchema),
            ),
        };
    };
}

function mapRecord(
    record: CollisionRecord,
    fileBySchema: ReadonlyMap<string, string>,
): GrammarToolCollisionLike {
    const fileA = fileBySchema.get(record.schemaA);
    const fileB = fileBySchema.get(record.schemaB);
    return {
        schemaA: record.schemaA,
        schemaB: record.schemaB,
        witnessText: record.witnessText,
        ...(record.rulePatternA !== undefined
            ? { rulePatternA: record.rulePatternA }
            : {}),
        ...(record.rulePatternB !== undefined
            ? { rulePatternB: record.rulePatternB }
            : {}),
        ...(fileA !== undefined ? { fileA } : {}),
        ...(fileB !== undefined ? { fileB } : {}),
    };
}

/**
 * Prefer the human-authored `.agr` grammar source over the compiled
 * `.ag.json` artifact when one sits at the conventional `src/` location, so
 * navigation lands on editable grammar rather than generated JSON. Falls back
 * to the compiled file when no source is found.
 */
async function resolveGrammarSource(agJsonFile: string): Promise<string> {
    const candidate = agJsonFile
        .replace(`${path.sep}dist${path.sep}`, `${path.sep}src${path.sep}`)
        .replace(/\.ag\.json$/i, ".agr");
    if (candidate !== agJsonFile) {
        try {
            await access(candidate);
            return candidate;
        } catch {
            // fall through to the compiled artifact
        }
    }
    return agJsonFile;
}

/**
 * Recursively collect compiled grammar files (`*.ag.json`) under a directory,
 * skipping heavy/irrelevant folders. Compiled grammars are emitted to each
 * agent's build output (`dist/`), so a recursive walk is required.
 */
async function findFilesWithSuffix(
    dir: string,
    suffix: string,
): Promise<string[]> {
    let entries: Dirent[];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    const out: string[] = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (
                entry.name === "node_modules" ||
                entry.name === ".git" ||
                entry.name === ".turbo"
            ) {
                continue;
            }
            out.push(...(await findFilesWithSuffix(full, suffix)));
        } else if (entry.isFile() && entry.name.endsWith(suffix)) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Whether an agent package has a grammar-compile script (`agc` or `agc:all`,
 * or any `agc:*` variant). Used to decide whether an unbuilt grammar can
 * actually be compiled, vs. shipping `.agr` source with no build step.
 */
async function hasGrammarCompileScript(packageDir: string): Promise<boolean> {
    try {
        const raw = await readFile(
            path.join(packageDir, "package.json"),
            "utf8",
        );
        const parsed: unknown = JSON.parse(raw);
        const scripts = (parsed as { scripts?: unknown }).scripts;
        if (typeof scripts !== "object" || scripts === null) {
            return false;
        }
        return Object.keys(scripts).some(
            (name) => name === "agc" || name.startsWith("agc:"),
        );
    } catch {
        return false;
    }
}
