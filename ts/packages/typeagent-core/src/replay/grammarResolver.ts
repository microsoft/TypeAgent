// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * F4.x / L1 — Grammar replay resolver (the "real replay path", schema-enriched).
 *
 * Replaces the stub identity resolver with one that actually evaluates each
 * corpus utterance against two grammar versions (A and B) so a genuine grammar
 * edit produces a genuine `actionA ≠ actionB` row in the Impact Report.
 *
 * Matching runs through the **real `agent-cache` grammar store**
 * ({@link GrammarStoreImpl}) — the same component the dispatcher's deterministic
 * path uses — rather than a bespoke `matchGrammarWithNFA` call. Two fidelity
 * gains over the bare-NFA first slice:
 *  - **Schema enrichment (L1):** when the agent's action-schema source + paramSpec
 *    config can be discovered, the grammar is enriched with checked-variable
 *    metadata (`enrichGrammarWithCheckedVariables`) before NFA compilation, so
 *    `checked_wildcard` parameters compile with the `checked` flag exactly as the
 *    dispatcher does. This drives the method label `"schema-grammar"`.
 *  - **Faithful disambiguation:** the grammar store ranks candidate matches with
 *    `sortMatches` (the dispatcher's ordering) instead of taking the raw first
 *    NFA match, so ambiguous utterances resolve to the same action the
 *    dispatcher would pick. Without a discoverable schema this still applies, but
 *    without enrichment — the method label is `"static-grammar"`.
 *
 * This is still **static grammar replay**, not full dispatcher fidelity: it does
 * NOT consult the construction/explanation cache and does NOT validate wildcard
 * *values* (e.g. confirming a real Spotify track) — that requires the live
 * construction cache + external APIs and is a later rung on the fidelity ladder
 * (L2+). Results remain indicative. See
 * `docs/plans/vscode-devx/05-implementation-plan.md` §9 and the design notes
 * `real-replay-path-design.md` / `long-pole-fidelity-plan.md`.
 *
 * Kept out of `replay/index.ts` (and behind the dedicated
 * `@typeagent/core/replayResolver` export) so importing the lightweight replay
 * engine/types does not pull in the heavier grammar/cache/schema engines.
 */

import path from "node:path";
import type { Dirent } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
    loadGrammarRules,
    enrichGrammarWithCheckedVariables,
    registerBuiltInEntities,
} from "@typeagent/action-grammar";
import {
    parseActionSchemaSource,
    type SchemaConfig,
} from "@typeagent/action-schema";
import { GrammarStoreImpl, type MatchResult } from "agent-cache";
import {
    resolveAgentPackageDir,
    resolveAgentRoots,
    type AgentRootsInput,
} from "../health/index.js";
import type { CorpusEntry } from "../corpus/types.js";
import type { VersionSpec } from "./types.js";
import type { ReplayActionResolver, ReplayAgentResolution } from "./engine.js";

const execFileAsync = promisify(execFile);

/**
 * A built, ready-to-match grammar store for one version, built once per side per
 * run. `enriched` records whether checked-variable schema enrichment was applied
 * (drives the run's method label).
 */
type BuiltGrammar = {
    store: GrammarStoreImpl;
    enriched: boolean;
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
    /**
     * Action-schema source for checked-variable enrichment (L1). When present,
     * the grammar is enriched with `checked_wildcard` metadata before NFA
     * compilation so matching mirrors the dispatcher. Absent when the schema
     * can't be unambiguously discovered — matching still runs through the real
     * grammar store, just without enrichment.
     */
    schema?: GrammarReplaySchema;
}

/**
 * Locates the action-schema TypeScript source (+ optional paramSpec config) used
 * to enrich the grammar with checked-variable metadata. Read at the SAME version
 * as the grammar so A/B stays symmetric when the schema itself is edited.
 */
export interface GrammarReplaySchema {
    /** Absolute path to the action-schema `.ts` source in the working tree. */
    sourceFilePath: string;
    /** Root action type name (manifest `schema.schemaType.action`). */
    actionTypeName: string;
    /** Optional entity type name (manifest `schema.schemaType.entity`). */
    entityTypeName?: string;
    /**
     * Absolute path to the sibling paramSpec config JSON, when present. This is
     * where `checked_wildcard` lives for agents like `player`
     * (`playerSchema.json`); without it enrichment finds no checked variables.
     */
    paramSpecConfigPath?: string;
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
    /**
     * Whether checked-variable schema enrichment was applied (both sides). Only
     * meaningful after {@link prepare} resolves; drives the run's method label
     * (`"schema-grammar"` vs `"static-grammar"`).
     */
    readonly enriched: boolean;
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

/** Read a file's content at a given version (working tree or git ref). */
async function readFileAtVersion(
    filePath: string,
    version: VersionSpec,
): Promise<string> {
    if (version.kind === "workingTree") {
        // Read the live working tree so uncommitted edits are reflected — the
        // entire point of "working tree vs HEAD".
        return readFile(filePath, "utf8");
    }
    // `git show <ref>:<path>` is read-only and stateless — no worktree/checkout
    // to create or clean up (the resolver interface has no disposer hook).
    const gitRoot = await gitToplevel(path.dirname(filePath));
    const relPath = path.relative(gitRoot, filePath).split(path.sep).join("/");
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

/**
 * Parse the agent's action schema at a version and return it for enrichment.
 * The paramSpec config (where `checked_wildcard` lives) is read from the sibling
 * JSON when configured. Read at the same version as the grammar so A/B stays
 * symmetric; a read/parse failure is surfaced as a {@link ReplayVersionBuildError}
 * rather than silently producing asymmetric (one-side-enriched) fidelity.
 */
async function parseSchemaAtVersion(
    schema: GrammarReplaySchema,
    schemaName: string,
    version: VersionSpec,
): Promise<ReturnType<typeof parseActionSchemaSource>> {
    const source = await readFileAtVersion(schema.sourceFilePath, version);
    let schemaConfig: SchemaConfig | undefined;
    if (schema.paramSpecConfigPath !== undefined) {
        const configText = await readFileAtVersion(
            schema.paramSpecConfigPath,
            version,
        );
        schemaConfig = JSON.parse(configText) as SchemaConfig;
    }
    return parseActionSchemaSource(
        source,
        schemaName,
        {
            action: schema.actionTypeName,
            ...(schema.entityTypeName !== undefined
                ? { entity: schema.entityTypeName }
                : {}),
        },
        path.basename(schema.sourceFilePath),
        schemaConfig,
    );
}

async function buildGrammar(
    target: GrammarReplayTarget,
    version: VersionSpec,
    side: "A" | "B",
): Promise<BuiltGrammar> {
    ensureBuiltInEntities();

    let content: string;
    try {
        content = await readFileAtVersion(target.grammarFilePath, version);
    } catch (err) {
        throw new ReplayVersionBuildError(
            side,
            version,
            `Failed to read grammar source for ${target.agent} (side ${side}): ${errorMessage(err)}`,
            err,
        );
    }

    // Best-effort schema enrichment (L1). A schema read/parse failure must NOT
    // abort an otherwise-valid grammar replay: degrade to the non-enriched
    // grammar-store path instead (the run reports method `static-grammar`). The
    // enrichability of a given schema source is deterministic across versions,
    // so the symmetric run-level `enriched` flag (computed by the resolver from
    // both sides) stays consistent for the supported working-tree-vs-ref journey.
    let enriched = false;
    let parsedSchema: ReturnType<typeof parseActionSchemaSource> | undefined;
    if (target.schema !== undefined) {
        try {
            parsedSchema = await parseSchemaAtVersion(
                target.schema,
                target.schemaName,
                version,
            );
            enriched = true;
        } catch {
            // Leave `enriched = false`; fall through to plain grammar matching.
            parsedSchema = undefined;
        }
    }

    try {
        const grammar = loadGrammarRules(
            target.grammarFileName ?? path.basename(target.grammarFilePath),
            content,
            target.start !== undefined ? { start: target.start } : undefined,
        );
        if (parsedSchema !== undefined) {
            // Mutates in place — adds checked-variable metadata that
            // `compileGrammarToNFA` (run by `addGrammar` below) honors.
            enrichGrammarWithCheckedVariables(grammar, parsedSchema);
        }
        // Route matching through the real dispatcher-grade grammar store: NFA
        // matching + `sortMatches` ranking, so ambiguous utterances resolve to
        // the action the dispatcher would pick.
        const store = new GrammarStoreImpl(undefined);
        store.setUseNFA(true);
        store.addGrammar(target.schemaName, grammar);
        return { store, enriched };
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
 * Normalize a resolved grammar-store action into a comparable action shape.
 *
 * `GrammarStoreImpl.match(...)` returns `MatchResult[]` whose `match` is a
 * `RequestAction`; the underlying action lives at `actions[0].action` as
 * `{ schemaName, actionName, parameters? }`. Two adjustments make A/B comparison
 * (and Impact Report display) correct:
 *  - re-stamp `schemaName` so the action mirrors the configured target schema;
 *  - canonicalize empty `parameters`: the grammar evaluator omits the field when
 *    empty, but mixed sources may carry `{}`; `actionsEqual` is strict on key
 *    counts, so `{}` must be treated as omitted.
 *
 * Returns `undefined` when the value is not an action object (treated as a miss
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

/** Pull the underlying action object out of the top-ranked grammar-store match. */
function topMatchAction(results: MatchResult[]): unknown {
    const top = results[0];
    if (top === undefined) {
        return undefined;
    }
    const actions = top.match.actions;
    return actions.length > 0 ? actions[0].action : undefined;
}

/**
 * Build a {@link GrammarReplayResolver}. Construct ONE per replay run so the
 * per-side grammar store never outlives a single `(versionA, versionB)` pair.
 */
export function createGrammarReplayResolver(
    opts: CreateGrammarReplayResolverOptions,
): GrammarReplayResolver {
    const { target } = opts;
    const now = opts.now ?? (() => Date.now());
    // Memoize the compiled store per side: A built once, B built once. Safe to
    // key on side because the engine always calls resolve(_, versionA, "A") and
    // resolve(_, versionB, "B") within a single run.
    const built = new Map<"A" | "B", Promise<BuiltGrammar>>();
    // Run-level enrichment flag: true only when BOTH sides enriched, so the
    // method label never claims schema enrichment for an asymmetric run.
    let runEnriched = false;

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
        // Authoritative only after prepare(): both sides enriched successfully.
        get enriched(): boolean {
            return runEnriched;
        },

        async prepare(versionA, versionB): Promise<void> {
            // Build A then B so the first failure (by side) is the one reported.
            const a = await build(versionA, "A");
            const b = await build(versionB, "B");
            runEnriched = a.enriched && b.enriched;
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

            const results = g.store.match(entry.utterance);
            const latencyMs = now() - t0;
            const action =
                results.length > 0
                    ? normalizeGrammarAction(
                          target.schemaName,
                          topMatchAction(results),
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
    const schema = await discoverSchemaTarget(srcDir);
    return {
        agent,
        schemaName: agent,
        grammarFilePath: agrFiles[0],
        ...(schema !== undefined ? { schema } : {}),
    };
}

/** Shape of the bits of an agent manifest we read for schema discovery. */
interface ManifestForSchema {
    schema?: {
        originalSchemaFile?: string;
        schemaType?: { action?: string; entity?: string };
    };
    subActionManifests?: Record<string, unknown>;
}

/**
 * Best-effort discovery of the agent's action-schema source for checked-variable
 * enrichment (L1). Reads the single agent manifest under `src/` for
 * `schema.originalSchemaFile` + `schema.schemaType.action`; the paramSpec config
 * (where `checked_wildcard` lives) is the sibling `<basename>.json` by
 * convention (matches how `asc` consumes it at build time). Returns `undefined`
 * — disabling enrichment, not the whole resolver — when the schema can't be
 * unambiguously resolved (no/many manifests, multi-schema agents, missing type
 * name, or a missing source file), so matching still runs through the real
 * grammar store, just without checked-variable metadata.
 */
async function discoverSchemaTarget(
    srcDir: string,
): Promise<GrammarReplaySchema | undefined> {
    const manifestFiles = await findManifestFiles(srcDir);
    if (manifestFiles.length !== 1) {
        return undefined;
    }
    const manifestFile = manifestFiles[0];

    let manifest: ManifestForSchema;
    try {
        manifest = JSON.parse(
            await readFile(manifestFile, "utf8"),
        ) as ManifestForSchema;
    } catch {
        return undefined;
    }

    // Multi-schema agents are out of scope for the single-grammar resolver.
    if (
        manifest.subActionManifests !== undefined &&
        Object.keys(manifest.subActionManifests).length > 0
    ) {
        return undefined;
    }

    const originalSchemaFile = manifest.schema?.originalSchemaFile;
    const actionTypeName = manifest.schema?.schemaType?.action;
    if (
        typeof originalSchemaFile !== "string" ||
        typeof actionTypeName !== "string"
    ) {
        return undefined;
    }

    const sourceFilePath = path.resolve(
        path.dirname(manifestFile),
        originalSchemaFile,
    );
    if (!(await isFile(sourceFilePath))) {
        return undefined;
    }

    // Sibling `<basename>.json` paramSpec config, when present.
    const configPath = path.join(
        path.dirname(sourceFilePath),
        `${path.basename(sourceFilePath, path.extname(sourceFilePath))}.json`,
    );
    const hasConfig = await isFile(configPath);

    const entityTypeName = manifest.schema?.schemaType?.entity;
    return {
        sourceFilePath,
        actionTypeName,
        ...(typeof entityTypeName === "string" ? { entityTypeName } : {}),
        ...(hasConfig ? { paramSpecConfigPath: configPath } : {}),
    };
}

async function isFile(p: string): Promise<boolean> {
    try {
        return (await stat(p)).isFile();
    } catch {
        return false;
    }
}

/** Recursively collect `*manifest.json` files under a directory. */
async function findManifestFiles(dir: string): Promise<string[]> {
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
            out.push(...(await findManifestFiles(full)));
        } else if (
            entry.isFile() &&
            entry.name.toLowerCase().endsWith("manifest.json")
        ) {
            out.push(full);
        }
    }
    return out;
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
