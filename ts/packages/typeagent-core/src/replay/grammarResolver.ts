// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar replay resolver (the "real replay path", schema-enriched).
 *
 * Replaces the stub identity resolver with one that actually evaluates each
 * corpus utterance against two grammar versions (A and B) so a genuine grammar
 * edit produces a genuine `actionA ≠ actionB` row in the Impact Report.
 *
 * Matching runs through the **real `agent-cache` grammar store**
 * ({@link GrammarStoreImpl}) — the same component the dispatcher's deterministic
 * path uses — rather than a bespoke `matchGrammarWithNFA` call. Two fidelity
 * gains over a bare-NFA match:
 *  - **Schema enrichment:** when the agent's action-schema source + paramSpec
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
 * This is still **static grammar replay**, not full dispatcher fidelity: by
 * itself it does NOT validate wildcard *values* (e.g. confirming a real Spotify
 * track), which requires external APIs. When a live construction-cache layer is
 * supplied, the working-tree side also consults that cache before falling back
 * to the grammar match. Results remain indicative.
 *
 * Kept out of `replay/index.ts` (and behind the dedicated
 * `@typeagent/core/replayResolver` export) so importing the lightweight replay
 * engine/types does not pull in the heavier grammar/cache/schema engines.
 */

import path from "node:path";
import type { Dirent } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
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
import { normalizeAction } from "./replayActionShape.js";
import type {
    ConstructionCacheLayer,
    ConstructionCacheStatus,
} from "./constructionCacheResolver.js";
import type { WildcardMatchValidator } from "./wildcardValidator.js";

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
 * discovery — this targets single-schema, standalone-compilable
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
     * Action-schema source for checked-variable enrichment. When present,
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
    /**
     * The manifest's raw `schema.schemaType` object (`{ action, entity? }`),
     * captured verbatim so the construction-cache hash gate can reproduce the
     * dispatcher's `JSON.stringify(schemaType)` byte-for-byte (key order matters).
     */
    schemaType: Record<string, unknown>;
    /**
     * Absolute path to the manifest's built `schemaFile` (`.pas.json`) when the
     * manifest declares one. The dispatcher hashes this artifact (with no sidecar
     * config) in preference to the `.ts` source; absent when the manifest has no
     * `schemaFile` (then the `.ts` source + sidecar config are hashed instead).
     */
    builtSchemaFilePath?: string;
}

export interface CreateGrammarReplayResolverOptions {
    target: GrammarReplayTarget;
    /** Repo root used to resolve relative agent roots; only needed for discovery. */
    repoRoot?: string;
    /** Clock injection for deterministic latency in tests. */
    now?: () => number;
    /**
     * Live construction-cache layer. When provided and `valid`, the
     * **working-tree** side consults it before the grammar so a construction
     * `hit` is reported distinctly from a grammar-only resolution (`miss`).
     * Only the working-tree side uses it — construction caches are never read at
     * a git ref. A `stale`/`absent` layer leaves behavior at the grammar match.
     */
    constructionCache?: ConstructionCacheLayer;
    /**
     * Runs the agent's real `validateWildcardMatch` over each candidate grammar
     * match that captured a wildcard, mirroring the dispatcher's post-match
     * `getValidatedMatches`. When provided, the **working-tree** side validates
     * the ranked match list and resolves the first match the agent accepts (a
     * rejected wildcard match falls through, exactly as the dispatcher falls back
     * to a lower match / the LLM). Working-tree only; never run at a git ref
     * (loading arbitrary-ref agent code is out of scope). Fail-open: only an
     * explicit `false` drops a match.
     */
    wildcardValidator?: WildcardMatchValidator;
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
    /**
     * Status of the live construction-cache layer, or `undefined` when no
     * layer was supplied. `"valid"` drives the `"construction-cache"` method
     * label; `"stale"`/`"absent"` fall back to the grammar method label.
     */
    readonly constructionCacheStatus: ConstructionCacheStatus | undefined;
    /**
     * Whether the wildcard validator actually ran on at least one match this run
     * (i.e. a wildcard match occurred on the working-tree side and the validator
     * was consulted). Drives the run's "+ wildcard validation" reporting. Always
     * `false` when no validator was supplied.
     */
    readonly wildcardValidationApplied: boolean;
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
    // Canonicalize the file path first: `git rev-parse --show-toplevel` returns a
    // symlink-resolved path, so on platforms where the temp/working dir lives
    // behind a symlink (e.g. macOS `/var` -> `/private/var`) an un-resolved
    // file path would yield a relative path that escapes the repo root.
    const realFilePath = await realpath(filePath);
    const gitRoot = await gitToplevel(path.dirname(realFilePath));
    const relPath = path
        .relative(gitRoot, realFilePath)
        .split(path.sep)
        .join("/");
    const { stdout } = await execFileAsync(
        "git",
        // `--end-of-options` stops a ref that begins with `-` from being parsed
        // as a `git show` option (e.g. `--output=…` would write a file).
        [
            "-C",
            gitRoot,
            "show",
            "--end-of-options",
            `${version.ref}:${relPath}`,
        ],
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

    // Best-effort schema enrichment. A schema read/parse failure must NOT
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
 * Re-exported from {@link normalizeAction} (shared with the construction-cache
 * layer) under the original name for back-compat with existing imports/tests.
 */
export { normalizeAction as normalizeGrammarAction };

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
 * Mirror the dispatcher's `getValidatedMatches` for the wildcard step: walk the
 * heuristically-ranked matches and return the action of the first one the agent
 * accepts. A match with no wildcard capture (`wildcardCharCount === 0`) is
 * accepted without consulting the validator (exactly as the dispatcher
 * short-circuits); a wildcard match is dropped only on an explicit `false`
 * verdict, and the walk continues to the next candidate (the dispatcher's
 * fall-back-to-a-lower-match behavior). Returns `undefined` when every candidate
 * was rejected — the row then becomes `needs-explanation`, the deterministic
 * stand-in for the dispatcher falling back to the LLM.
 */
/**
 * Mirror the dispatcher's `getValidatedMatches` for the wildcard step: walk the
 * heuristically-ranked matches and return the action of the first one the agent
 * accepts. A match with no wildcard capture (`wildcardCharCount === 0`) is
 * accepted without consulting the validator (exactly as the dispatcher
 * short-circuits); a wildcard match is dropped only on an explicit `false`
 * verdict, and the walk continues to the next candidate (the dispatcher's
 * fall-back-to-a-lower-match behavior). Returns `action: undefined` when every
 * candidate was rejected — the row then becomes `needs-explanation`, the
 * deterministic stand-in for the dispatcher falling back to the LLM.
 *
 * Exported for unit testing the ranked-selection contract.
 */
export async function selectValidatedMatchAction(
    results: MatchResult[],
    validator: WildcardMatchValidator,
): Promise<{ action: unknown; consulted: boolean }> {
    let consulted = false;
    for (const result of results) {
        const actions = result.match.actions;
        if (actions.length === 0) {
            continue;
        }
        if (result.wildcardCharCount === 0) {
            return { action: actions[0].action, consulted };
        }
        consulted = true;
        const outcome = await validator.validateMatch(actions);
        if (!outcome.rejected) {
            return { action: actions[0].action, consulted };
        }
    }
    return { action: undefined, consulted };
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
    const constructionCache = opts.constructionCache;
    const wildcardValidator = opts.wildcardValidator;
    let wildcardValidationApplied = false;
    // Construction-cache consult is faithful to the dispatcher only for the live
    // working tree, and only when the cache's namespace hash still matches.
    const constructionActive =
        constructionCache !== undefined && constructionCache.status === "valid";
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

        get constructionCacheStatus(): ConstructionCacheStatus | undefined {
            return constructionCache?.status;
        },

        get wildcardValidationApplied(): boolean {
            return wildcardValidationApplied;
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

            // On the working-tree side, consult the live construction cache
            // first — the dispatcher's real first check. A construction hit is a
            // genuine cache `hit`; everything the cache doesn't resolve falls
            // through to the grammar path below and is reported as a `miss`
            // (deterministically resolvable, but not served from the cache).
            const useConstruction =
                constructionActive && version.kind === "workingTree";
            if (useConstruction) {
                const cacheAction = constructionCache!.match(entry.utterance);
                if (cacheAction !== undefined) {
                    return {
                        action: cacheAction,
                        cacheState: "hit",
                        latencyMs: now() - t0,
                        ...feedback,
                    };
                }
            }

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

            // Wildcard validation (L4a): on the working-tree side, run the
            // agent's real `validateWildcardMatch` over the ranked candidates and
            // resolve the first accepted match — mirroring the dispatcher's
            // post-match `getValidatedMatches`. Never on a git ref (we can't load
            // arbitrary-ref agent code). When no validator is supplied this is a
            // plain top-match resolution (unchanged behavior).
            const validateHere =
                wildcardValidator !== undefined &&
                version.kind === "workingTree";
            let rawAction: unknown;
            if (validateHere) {
                const validated = await selectValidatedMatchAction(
                    results,
                    wildcardValidator!,
                );
                rawAction = validated.action;
                if (validated.consulted) {
                    wildcardValidationApplied = true;
                }
            } else {
                rawAction =
                    results.length > 0 ? topMatchAction(results) : undefined;
            }

            const latencyMs = now() - t0;
            const action =
                rawAction !== undefined
                    ? normalizeAction(target.schemaName, rawAction)
                    : undefined;

            if (action === undefined) {
                return {
                    cacheState: "needs-explanation",
                    latencyMs,
                    ...feedback,
                };
            }
            // When the live construction cache is in play, a grammar-only
            // resolution is reported as a `miss` (not in the cache) to keep the
            // working-tree side's cache states faithful; otherwise it is a plain
            // grammar `hit` (unchanged grammar-match semantics).
            const cacheState = useConstruction ? "miss" : "hit";
            return { action, cacheState, latencyMs, ...feedback };
        },
    };
}

/**
 * Resolve the grammar target for an agent by probing the agent roots for its
 * package and finding a single `.agr` under `src/`. Returns `undefined` when
 * the agent has zero or multiple `.agr` files — this only handles
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
        schemaFile?: string;
        schemaType?: { action?: string; entity?: string };
    };
    subActionManifests?: Record<string, unknown>;
}

/**
 * Best-effort discovery of the agent's action-schema source for checked-variable
 * enrichment. Reads the single agent manifest under `src/` for
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

    // Capture the construction-cache hash inputs: the raw schemaType object (for a byte-faithful
    // JSON.stringify) and the built `.pas.json` artifact path when the manifest
    // declares one (the dispatcher hashes the built schema in preference to the
    // `.ts` source, with no sidecar config).
    const schemaType: Record<string, unknown> = {
        ...(manifest.schema?.schemaType as Record<string, unknown> | undefined),
    };
    const declaredSchemaFile = manifest.schema?.schemaFile;
    let builtSchemaFilePath: string | undefined;
    // Only a *built* `.pas.json` artifact is hashed with no sidecar config (as
    // the dispatcher does). A `.ts` `schemaFile` is hashed from source *with*
    // its paramSpec config, which the sourceFilePath + paramSpecConfigPath path
    // below already reproduces — so leaving builtSchemaFilePath unset for a
    // non-`.pas.json` schemaFile keeps the hash faithful instead of silently
    // mismatching (which would disable the construction-cache consult for that agent).
    if (
        typeof declaredSchemaFile === "string" &&
        declaredSchemaFile.endsWith(".pas.json")
    ) {
        const resolved = path.resolve(
            path.dirname(manifestFile),
            declaredSchemaFile,
        );
        if (await isFile(resolved)) {
            builtSchemaFilePath = resolved;
        }
    }

    return {
        sourceFilePath,
        actionTypeName,
        ...(typeof entityTypeName === "string" ? { entityTypeName } : {}),
        ...(hasConfig ? { paramSpecConfigPath: configPath } : {}),
        schemaType,
        ...(builtSchemaFilePath !== undefined ? { builtSchemaFilePath } : {}),
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
