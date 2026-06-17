// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * F4.x — Static grammar replay resolver (first slice of the "real replay path").
 *
 * Replaces the stub identity resolver with one that actually evaluates each
 * corpus utterance against two grammar versions (A and B) so a genuine grammar
 * edit produces a genuine `actionA ≠ actionB` row in the Impact Report.
 *
 * This is **static grammar replay**, not full dispatcher fidelity. The real
 * deterministic dispatcher checks the construction/explanation cache *before*
 * static grammar, enriches grammars with schema-derived checked-variable
 * metadata, and validates matches (e.g. player's wildcard validation). This
 * slice does none of that — it resolves purely through the `@typeagent/action-grammar`
 * pipeline (`loadGrammarRules` → `compileGrammarToNFA` → `matchGrammarWithNFA`).
 * It is faithful enough to prove the engine → ActionDelta → Impact Report
 * pipeline on real grammar edits for single-schema, no-wildcard agents (e.g.
 * `player`'s `pause`/`resume`/`next`). Full construction-cache / full-dispatch
 * resolution is a later slice behind the same {@link ReplayActionResolver}
 * interface. See `docs/plans/vscode-devx/05-implementation-plan.md` §9 and the
 * design note `real-replay-path-design.md`.
 *
 * Kept out of `replay/index.ts` (and behind the dedicated
 * `@typeagent/core/replayResolver` export) so importing the lightweight replay
 * engine/types does not pull in the heavier `action-grammar` engine.
 */

import path from "node:path";
import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
    loadGrammarRules,
    compileGrammarToNFA,
    matchGrammarWithNFA,
    registerBuiltInEntities,
} from "@typeagent/action-grammar";
import {
    resolveAgentPackageDir,
    resolveAgentRoots,
    type AgentRootsInput,
} from "../health/index.js";
import type { CorpusEntry } from "../corpus/types.js";
import type { VersionSpec } from "./types.js";
import type { ReplayActionResolver, ReplayAgentResolution } from "./engine.js";

const execFileAsync = promisify(execFile);

/** Compiled grammar + NFA for one version, built once per side per run. */
type BuiltGrammar = {
    grammar: ReturnType<typeof loadGrammarRules>;
    nfa: ReturnType<typeof compileGrammarToNFA>;
};

/**
 * A version failed to materialize or compile. This is a run-level diagnostic,
 * NOT a per-row corpus regression: surfacing it as `needs-explanation` rows
 * would make the engine classify every utterance as a fake `newMatch`/
 * `lostMatch`. Callers should fail the run and report the build failure.
 */
export class ReplayVersionBuildError extends Error {
    constructor(
        public readonly side: "A" | "B",
        public readonly version: VersionSpec,
        message: string,
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = "ReplayVersionBuildError";
    }
}

/** Run-level error returned to the runtime caller when a version won't build. */
export interface ReplayRunError {
    kind: "version-build-failed";
    side: "A" | "B";
    /** The git ref, or `"workingTree"` for the live-tree side. */
    ref: string;
    message: string;
}

/**
 * Identifies which grammar to compile for an agent. Deliberately explicit (a
 * single grammar file + schema name) rather than dispatcher-style manifest
 * discovery — the first slice targets single-schema, standalone-compilable
 * agents only.
 */
export interface GrammarReplayTarget {
    agent: string;
    /** Schema name stamped onto resolved actions (cosmetic for the Impact Report). */
    schemaName: string;
    /** Absolute path to the agent's `.agr` grammar in the working tree. */
    grammarFilePath: string;
    /** Display name passed to `loadGrammarRules`; defaults to the file's basename. */
    grammarFileName?: string;
    /** Grammar start symbol; defaults to the loader default (`"Start"`). */
    start?: string;
    /** NFA tag for debugging; defaults to `<agent>-<side>`. */
    nfaTag?: string;
}

export interface CreateGrammarReplayResolverOptions {
    target: GrammarReplayTarget;
    /** Repo root used to resolve relative agent roots; only needed for discovery. */
    repoRoot?: string;
    /** Clock injection for deterministic latency in tests. */
    now?: () => number;
}

/**
 * A {@link ReplayActionResolver} backed by static grammar matching. `prepare`
 * compiles both versions up front so a build failure surfaces as a clean
 * run-level error (via {@link ReplayVersionBuildError}) BEFORE the engine loop
 * starts — the engine does not catch resolver exceptions, so throwing mid-run
 * would hang the row stream.
 */
export interface GrammarReplayResolver extends ReplayActionResolver {
    /**
     * Compile both versions. Throws {@link ReplayVersionBuildError} if either
     * side fails to materialize or compile.
     */
    prepare(versionA: VersionSpec, versionB: VersionSpec): Promise<void>;
}

let entitiesRegistered = false;
function ensureBuiltInEntities(): void {
    if (!entitiesRegistered) {
        registerBuiltInEntities();
        entitiesRegistered = true;
    }
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Resolve a grammar file's content at a given version. */
async function readGrammarSource(
    target: GrammarReplayTarget,
    version: VersionSpec,
): Promise<string> {
    if (version.kind === "workingTree") {
        // Read the live working tree so uncommitted edits are reflected — the
        // entire point of "working tree vs HEAD".
        return readFile(target.grammarFilePath, "utf8");
    }
    // `git show <ref>:<path>` is read-only and stateless — no worktree/checkout
    // to create or clean up (the resolver interface has no disposer hook).
    const gitRoot = await gitToplevel(path.dirname(target.grammarFilePath));
    const relPath = path
        .relative(gitRoot, target.grammarFilePath)
        .split(path.sep)
        .join("/");
    const { stdout } = await execFileAsync(
        "git",
        ["-C", gitRoot, "show", `${version.ref}:${relPath}`],
        { maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout;
}

async function gitToplevel(cwd: string): Promise<string> {
    const { stdout } = await execFileAsync("git", [
        "-C",
        cwd,
        "rev-parse",
        "--show-toplevel",
    ]);
    return stdout.trim();
}

async function buildGrammar(
    target: GrammarReplayTarget,
    version: VersionSpec,
    side: "A" | "B",
): Promise<BuiltGrammar> {
    ensureBuiltInEntities();

    let content: string;
    try {
        content = await readGrammarSource(target, version);
    } catch (err) {
        throw new ReplayVersionBuildError(
            side,
            version,
            `Failed to read grammar source for ${target.agent} (side ${side}): ${errorMessage(err)}`,
            err,
        );
    }

    try {
        const grammar = loadGrammarRules(
            target.grammarFileName ?? path.basename(target.grammarFilePath),
            content,
            target.start !== undefined ? { start: target.start } : undefined,
        );
        const nfa = compileGrammarToNFA(
            grammar,
            target.nfaTag ?? `${target.agent}-${side}`,
        );
        return { grammar, nfa };
    } catch (err) {
        throw new ReplayVersionBuildError(
            side,
            version,
            `Failed to compile grammar for ${target.agent} (side ${side}): ${errorMessage(err)}`,
            err,
        );
    }
}

/**
 * Normalize a raw grammar match value into a comparable action shape.
 *
 * `matchGrammarWithNFA(...)[].match` returns the raw grammar value, e.g.
 * `{ actionName, parameters? }`. Two adjustments make A/B comparison (and Impact
 * Report display) correct:
 *  - stamp `schemaName` so the action mirrors what the dispatcher/grammar-store
 *    emits;
 *  - canonicalize empty `parameters`: the grammar evaluator omits the field when
 *    empty, but mixed sources may carry `{}`; `actionsEqual` is strict on key
 *    counts, so `{}` must be treated as omitted.
 *
 * Returns `undefined` when the match is not an action object (treated as a miss
 * → `needs-explanation`).
 */
export function normalizeGrammarAction(
    schemaName: string,
    raw: unknown,
): Record<string, unknown> | undefined {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.actionName !== "string") {
        return undefined;
    }
    const action: Record<string, unknown> = {
        schemaName,
        actionName: r.actionName,
    };
    const params = r.parameters;
    if (
        params !== undefined &&
        params !== null &&
        typeof params === "object" &&
        !Array.isArray(params) &&
        Object.keys(params as Record<string, unknown>).length > 0
    ) {
        action.parameters = params;
    }
    return action;
}

/**
 * Build a {@link GrammarReplayResolver}. Construct ONE per replay run so the
 * per-side NFA cache never outlives a single `(versionA, versionB)` pair.
 */
export function createGrammarReplayResolver(
    opts: CreateGrammarReplayResolverOptions,
): GrammarReplayResolver {
    const { target } = opts;
    const now = opts.now ?? (() => Date.now());
    // Memoize the compiled NFA per side: A built once, B built once. Safe to key
    // on side because the engine always calls resolve(_, versionA, "A") and
    // resolve(_, versionB, "B") within a single run.
    const built = new Map<"A" | "B", Promise<BuiltGrammar>>();

    function build(
        version: VersionSpec,
        side: "A" | "B",
    ): Promise<BuiltGrammar> {
        let pending = built.get(side);
        if (pending === undefined) {
            pending = buildGrammar(target, version, side);
            built.set(side, pending);
        }
        return pending;
    }

    return {
        async prepare(versionA, versionB): Promise<void> {
            // Build A then B so the first failure (by side) is the one reported.
            await build(versionA, "A");
            await build(versionB, "B");
        },

        async resolve(
            entry: CorpusEntry,
            version: VersionSpec,
            side: "A" | "B",
        ): Promise<ReplayAgentResolution> {
            const t0 = now();
            const feedback =
                entry.feedback !== undefined
                    ? { feedback: entry.feedback }
                    : {};

            let g: BuiltGrammar;
            try {
                g = await build(version, side);
            } catch {
                // prepare() is expected to have surfaced build failures as a
                // run-level error already; degrade safely here rather than throw
                // (a throw would hang the engine's row stream).
                return {
                    cacheState: "needs-explanation",
                    latencyMs: now() - t0,
                    ...feedback,
                };
            }

            const results = matchGrammarWithNFA(
                g.grammar,
                g.nfa,
                entry.utterance,
            );
            const latencyMs = now() - t0;
            const action =
                results.length > 0
                    ? normalizeGrammarAction(
                          target.schemaName,
                          results[0].match,
                      )
                    : undefined;

            if (action === undefined) {
                return {
                    cacheState: "needs-explanation",
                    latencyMs,
                    ...feedback,
                };
            }
            return { action, cacheState: "hit", latencyMs, ...feedback };
        },
    };
}

/**
 * Resolve the grammar target for an agent by probing the agent roots for its
 * package and finding a single `.agr` under `src/`. Returns `undefined` when
 * the agent has zero or multiple `.agr` files — the first slice only handles
 * single-schema, standalone-compilable agents, and picking among several would
 * risk compiling a grammar the dispatcher does not treat as the active schema.
 */
export async function resolveGrammarReplayTarget(
    agentRoots: AgentRootsInput,
    agent: string,
    repoRoot: string,
): Promise<GrammarReplayTarget | undefined> {
    const roots = resolveAgentRoots(agentRoots, repoRoot);
    const packageDir = await resolveAgentPackageDir(roots, agent);
    const srcDir = path.join(packageDir, "src");
    const agrFiles = await findAgrFiles(srcDir);
    if (agrFiles.length !== 1) {
        return undefined;
    }
    return {
        agent,
        schemaName: agent,
        grammarFilePath: agrFiles[0],
    };
}

/** Recursively collect `.agr` files under a directory, skipping heavy folders. */
async function findAgrFiles(dir: string): Promise<string[]> {
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
                entry.name === ".turbo" ||
                entry.name === "dist"
            ) {
                continue;
            }
            out.push(...(await findAgrFiles(full)));
        } else if (entry.isFile() && entry.name.endsWith(".agr")) {
            out.push(full);
        }
    }
    return out;
}
