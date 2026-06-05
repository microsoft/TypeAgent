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
import { readFile, readdir } from "node:fs/promises";
import { grammarFromJson, registerBuiltInEntities } from "action-grammar";
import {
    scanGrammarCollisions,
    type CollisionRecord,
    type SchemaInput,
} from "grammar-tools-core";
import type { GrammarToolCollisionLike } from "./types.js";

export interface GrammarScanRequest {
    /** Agent package names to scan (under `packages/agents/<name>`). */
    agents: string[];
}

export interface GrammarScanSkip {
    schemaName: string;
    reason: "no-grammar" | "parse-error" | "compile-error";
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

        const inputs: SchemaInput[] = [];
        const skipped: GrammarScanSkip[] = [];
        const seen = new Set<string>();

        for (const agent of agents) {
            const packageDir = path.join(repoRoot, "packages", "agents", agent);
            const compiled = await findAgJsonFiles(packageDir);
            if (compiled.length === 0) {
                skipped.push({ schemaName: agent, reason: "no-grammar" });
                continue;
            }
            for (const file of compiled) {
                const schemaName = schemaNameFromGrammarFile(file);
                if (seen.has(schemaName)) {
                    continue;
                }
                seen.add(schemaName);
                try {
                    const grammar = grammarFromJson(
                        JSON.parse(await readFile(file, "utf8")),
                    );
                    inputs.push({ schemaName, agentName: agent, grammar });
                } catch (err) {
                    skipped.push({
                        schemaName,
                        reason: "parse-error",
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        }

        const result = scanGrammarCollisions(inputs);

        for (const skip of result.skipped) {
            skipped.push({
                schemaName: skip.schemaName,
                reason: skip.reason,
                error: skip.error,
            });
        }

        return {
            scanned: Object.keys(result.schemas),
            skipped,
            collisions: Object.values(result.collisions).map(mapRecord),
        };
    };
}

function mapRecord(record: CollisionRecord): GrammarToolCollisionLike {
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
    };
}

/**
 * Recursively collect compiled grammar files (`*.ag.json`) under a directory,
 * skipping heavy/irrelevant folders. Compiled grammars are emitted to each
 * agent's build output (`dist/`), so a recursive walk is required.
 */
async function findAgJsonFiles(dir: string): Promise<string[]> {
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
            out.push(...(await findAgJsonFiles(full)));
        } else if (entry.isFile() && entry.name.endsWith(".ag.json")) {
            out.push(full);
        }
    }
    return out;
}
