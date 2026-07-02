// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type {
    AgentFileRefs,
    HealthContext,
    HealthFinding,
    HealthRule,
    HealthService,
} from "./types.js";

/**
 * Agent roots, supplied either as a fixed list or as a provider that is called
 * each time roots are needed (so a changed configuration is picked up without
 * reconstructing the consumer).
 */
export type AgentRootsInput = string[] | (() => string[]);

/** Resolve {@link AgentRootsInput} to a concrete list, defaulting from repoRoot. */
export function resolveAgentRoots(
    input: AgentRootsInput | undefined,
    repoRoot: string,
): string[] {
    if (typeof input === "function") {
        return input();
    }
    return input ?? defaultAgentRoots(repoRoot);
}

export interface FileHealthServiceOptions {
    repoRoot: string;
    /**
     * Ordered directories that contain agent subdirectories (each peer to
     * `packages/agents`). Defaults to `[<repoRoot>/packages/agents]`. May be a
     * provider so configuration changes are picked up without reconstruction.
     * An agent is resolved by probing each root for `<root>/<agent>`.
     */
    agentRoots?: AgentRootsInput;
    loadedActionTypes?: Record<string, string[]>;
    cacheSchemaHash?: string;
}

interface ManifestSchemaRef {
    originalSchemaFile?: string;
    schemaFile?: string;
    grammarFile?: string;
    injected?: boolean;
}

interface AgentManifest {
    schema?: ManifestSchemaRef;
    subActionManifests?: Record<string, { schema?: ManifestSchemaRef }>;
    name?: string;
}

export class FileHealthService implements HealthService {
    private readonly opts: FileHealthServiceOptions;
    private readonly ruleSet: HealthRule[];

    constructor(opts: FileHealthServiceOptions) {
        this.opts = opts;
        this.ruleSet = createRules();
    }

    rules(): HealthRule[] {
        return this.ruleSet;
    }

    async check(agent: string): Promise<HealthFinding[]> {
        const files = await discoverAgentFiles(
            resolveAgentRoots(this.opts.agentRoots, this.opts.repoRoot),
            agent,
        );
        const ctx: HealthContext = {
            repoRoot: this.opts.repoRoot,
            agent,
            files,
            ...(this.opts.loadedActionTypes !== undefined
                ? { loadedActionTypes: this.opts.loadedActionTypes }
                : {}),
            ...(this.opts.cacheSchemaHash !== undefined
                ? { cacheSchemaHash: this.opts.cacheSchemaHash }
                : {}),
        };
        const findings: HealthFinding[] = [];
        for (const rule of this.ruleSet) {
            findings.push(...(await rule.check(ctx)));
        }
        return findings;
    }
}

/** Default agent root: the monorepo's `packages/agents` under `repoRoot`. */
export function defaultAgentRoots(repoRoot: string): string[] {
    return [path.join(repoRoot, "packages", "agents")];
}

/**
 * Resolve an agent name to its package directory by probing each agent root in
 * order for an existing `<root>/<agent>`. Falls back to the first root's
 * `<root>/<agent>` (which simply won't resolve any files) so callers always get
 * a well-formed path and report `unknown`/missing gracefully.
 */
export async function resolveAgentPackageDir(
    agentRoots: string[],
    agent: string,
): Promise<string> {
    for (const root of agentRoots) {
        const candidate = path.join(root, agent);
        try {
            if ((await fs.stat(candidate)).isDirectory()) {
                return candidate;
            }
        } catch {
            // not here — try the next root
        }
    }
    return path.join(agentRoots[0] ?? "", agent);
}

export async function discoverAgentFiles(
    agentRoots: string[],
    agent: string,
): Promise<AgentFileRefs> {
    const packageDir = await resolveAgentPackageDir(agentRoots, agent);
    const srcDir = path.join(packageDir, "src");
    const all = await walkFiles(srcDir);

    // Prefer the package's declared entry points (the same exports the
    // dispatcher resolves via npmAgentProvider). Fall back to filename
    // heuristics when an export is missing or doesn't resolve to a real
    // source file — this keeps discovery robust for partially-authored
    // agents and for tests that don't author a full package.json.
    const declared = await readDeclaredEntries(packageDir);

    const manifestFile =
        declared.manifestFile ?? all.find((f) => /manifest\.json$/i.test(f));

    const schemaFiles = all.filter(
        (f) => /schema/i.test(path.basename(f)) && /\.(ts|json)$/i.test(f),
    );
    const grammarFiles = all.filter(
        (f) => /\.agr$/i.test(f) || /\.ag\.json$/i.test(f),
    );

    let handlerFiles: string[];
    if (declared.handlerFile !== undefined) {
        handlerFiles = [declared.handlerFile];
    } else {
        // Permissive filename match — the rule that consumes these files
        // (`handler.exports.instantiate`) inspects file contents, so
        // over-matching is harmless. Uses plain string checks rather than a
        // regex to avoid backtracking on adversarial file names.
        handlerFiles = all.filter((f) => {
            const base = path.basename(f).toLowerCase();
            return (
                base.includes("handler") &&
                (base.endsWith(".ts") || base.endsWith(".mts"))
            );
        });
    }

    return {
        packageDir,
        srcDir,
        ...(manifestFile !== undefined ? { manifestFile } : {}),
        schemaFiles,
        grammarFiles,
        handlerFiles,
    };
}

interface DeclaredEntries {
    manifestFile?: string;
    handlerFile?: string;
}

/**
 * Read the canonical manifest/handler entry points from the agent package's
 * `package.json` exports. The dispatcher loads each agent via the
 * `./agent/manifest` and `./agent/handlers` exports, so trusting them here
 * matches the runtime contract exactly and side-steps filename guessing.
 *
 * The handler export points at a built `dist/.../X.js` (or `.mjs`); we map
 * it back to the corresponding `src/.../X.ts` (or `.mts`) so the rule can
 * inspect the source. Returns no entry when the export is absent or its
 * source file cannot be located.
 */
async function readDeclaredEntries(
    packageDir: string,
): Promise<DeclaredEntries> {
    let pkg: { exports?: Record<string, unknown> };
    try {
        pkg = JSON.parse(
            await fs.readFile(path.join(packageDir, "package.json"), "utf8"),
        );
    } catch {
        return {};
    }

    const exp = pkg.exports;
    if (!exp || typeof exp !== "object") {
        return {};
    }

    const result: DeclaredEntries = {};

    const manifestRef = resolveExport(exp, "./agent/manifest");
    if (manifestRef !== undefined) {
        const abs = path.resolve(packageDir, manifestRef);
        if (await exists(abs)) {
            result.manifestFile = abs;
        }
    }

    const handlerRef = resolveExport(exp, "./agent/handlers");
    if (handlerRef !== undefined) {
        const handlerSrc = await resolveHandlerSource(packageDir, handlerRef);
        if (handlerSrc !== undefined) {
            result.handlerFile = handlerSrc;
        }
    }

    return result;
}

/**
 * Pick the file path out of an `exports[key]` entry, accepting both the
 * shorthand string form and the conditional-exports object form (taking
 * `default`/`import`/`require` in that order).
 */
function resolveExport(
    exp: Record<string, unknown>,
    key: string,
): string | undefined {
    const entry = exp[key];
    if (typeof entry === "string") {
        return entry;
    }
    if (entry && typeof entry === "object") {
        const obj = entry as Record<string, unknown>;
        for (const cond of ["default", "import", "require"]) {
            const v = obj[cond];
            if (typeof v === "string") {
                return v;
            }
        }
    }
    return undefined;
}

/**
 * Map a `./dist/.../X.{js,mjs}` handler export back to its `./src/.../X.{ts,mts}`
 * source file. Tries the parallel `dist`→`src` rewrite first, then falls
 * back to a basename match anywhere under `src/`.
 */
async function resolveHandlerSource(
    packageDir: string,
    distRef: string,
): Promise<string | undefined> {
    const normalized = distRef.replace(/^\.\//, "");
    const parallel = normalized
        .replace(/^dist[\\/]/, "src/")
        .replace(/\.mjs$/i, ".mts")
        .replace(/\.js$/i, ".ts");
    const parallelAbs = path.resolve(packageDir, parallel);
    if (await exists(parallelAbs)) {
        return parallelAbs;
    }

    const baseTs = path.basename(parallel);
    const candidates = await walkFiles(path.join(packageDir, "src"));
    const hit = candidates.find((f) => path.basename(f) === baseTs);
    return hit;
}

function createRules(): HealthRule[] {
    return [
        {
            id: "manifest.parses",
            description: "Manifest exists and parses as JSON.",
            check: async (ctx) => {
                if (!ctx.files.manifestFile) {
                    return [
                        err(
                            ctx,
                            "manifest.parses",
                            "Manifest file was not found under src/",
                        ),
                    ];
                }
                try {
                    JSON.parse(
                        await fs.readFile(ctx.files.manifestFile, "utf8"),
                    );
                    return [];
                } catch (e) {
                    return [
                        err(
                            ctx,
                            "manifest.parses",
                            `Manifest JSON parse failed: ${(e as Error).message}`,
                            ctx.files.manifestFile,
                        ),
                    ];
                }
            },
        },
        {
            id: "manifest.name.matches",
            description:
                "Manifest name (if present) matches package directory name.",
            check: async (ctx) => {
                const manifest = await readManifest(ctx);
                if (!manifest || manifest.name === undefined) {
                    return [];
                }
                return manifest.name === ctx.agent
                    ? []
                    : [
                          err(
                              ctx,
                              "manifest.name.matches",
                              `Manifest name '${manifest.name}' does not match agent '${ctx.agent}'.`,
                              ctx.files.manifestFile,
                          ),
                      ];
            },
        },
        {
            id: "manifest.schemaPath.exists",
            description: "Manifest-referenced schema/grammar files exist.",
            check: async (ctx) => {
                const manifest = await readManifest(ctx);
                if (!manifest) return [];
                const refs = collectManifestRefs(manifest);
                const missing: HealthFinding[] = [];
                for (const ref of refs) {
                    for (const candidate of [
                        ref.originalSchemaFile,
                        ref.schemaFile,
                        ref.grammarFile,
                    ]) {
                        if (!candidate) continue;
                        const abs = path.resolve(
                            path.dirname(ctx.files.manifestFile!),
                            candidate,
                        );
                        if (!(await exists(abs))) {
                            missing.push(
                                err(
                                    ctx,
                                    "manifest.schemaPath.exists",
                                    `Referenced file not found: ${candidate}`,
                                    ctx.files.manifestFile,
                                ),
                            );
                        }
                    }
                }
                return missing;
            },
        },
        {
            id: "schema.parses",
            description: "Schema files are parseable (JSON) or non-empty (TS).",
            check: async (ctx) => {
                const findings: HealthFinding[] = [];
                for (const file of ctx.files.schemaFiles) {
                    const text = await fs.readFile(file, "utf8");
                    if (text.trim().length === 0) {
                        findings.push(
                            err(
                                ctx,
                                "schema.parses",
                                "Schema file is empty.",
                                file,
                            ),
                        );
                        continue;
                    }
                    if (/\.json$/i.test(file)) {
                        try {
                            JSON.parse(text);
                        } catch (e) {
                            findings.push(
                                err(
                                    ctx,
                                    "schema.parses",
                                    `Schema JSON parse failed: ${(e as Error).message}`,
                                    file,
                                ),
                            );
                        }
                    }
                }
                return findings;
            },
        },
        {
            id: "schema.actions.haveGrammar",
            description:
                "At least one grammar file exists when schema files exist.",
            check: async (ctx) => {
                if (
                    ctx.files.schemaFiles.length === 0 ||
                    ctx.files.grammarFiles.length > 0
                ) {
                    return [];
                }
                // Injected agents (e.g. chat) are invoked as a fallback rather
                // than dispatched via grammar matching, so they're allowed to
                // ship a schema with no grammar. The dispatcher signals this
                // with `schema.injected: true`. Only suppress when *every*
                // declared schema is injected — if any non-injected schema
                // exists it legitimately needs a grammar, so keep warning.
                const manifest = await readManifest(ctx);
                if (manifest && allManifestSchemasInjected(manifest)) {
                    return [];
                }
                return [
                    warn(
                        ctx,
                        "schema.actions.haveGrammar",
                        "Schema files exist but no grammar files were discovered.",
                    ),
                ];
            },
        },
        {
            id: "grammar.parses",
            description:
                "Grammar files are parseable (JSON) or non-empty (AGR).",
            check: async (ctx) => {
                const findings: HealthFinding[] = [];
                for (const file of ctx.files.grammarFiles) {
                    const text = await fs.readFile(file, "utf8");
                    if (text.trim().length === 0) {
                        findings.push(
                            err(
                                ctx,
                                "grammar.parses",
                                "Grammar file is empty.",
                                file,
                            ),
                        );
                        continue;
                    }
                    if (/\.json$/i.test(file)) {
                        try {
                            JSON.parse(text);
                        } catch (e) {
                            findings.push(
                                err(
                                    ctx,
                                    "grammar.parses",
                                    `Grammar JSON parse failed: ${(e as Error).message}`,
                                    file,
                                ),
                            );
                        }
                    }
                }
                return findings;
            },
        },
        {
            id: "grammar.rules.targetKnownActions",
            description:
                "Grammar targets should map to known actions (heuristic check).",
            check: async (ctx) => {
                if (
                    ctx.files.grammarFiles.length === 0 ||
                    ctx.files.schemaFiles.length === 0
                ) {
                    return [];
                }
                // Heuristic: if we have both files, we assume target mapping is
                // checkable; strict semantic checks land when actionGrammar hooks in.
                return [];
            },
        },
        {
            id: "handler.exports.instantiate",
            description: "At least one action handler exports instantiate().",
            check: async (ctx) => {
                for (const file of ctx.files.handlerFiles) {
                    const text = await fs.readFile(file, "utf8");
                    if (
                        /export\s+(async\s+)?function\s+instantiate\s*\(/.test(
                            text,
                        )
                    ) {
                        return [];
                    }
                    if (/instantiate\s*:\s*(async\s*)?\(/.test(text)) {
                        return [];
                    }
                }
                return [
                    err(
                        ctx,
                        "handler.exports.instantiate",
                        "No action handler exporting instantiate() was found.",
                    ),
                ];
            },
        },
        {
            id: "actions.unique.acrossLoaded",
            description: "Loaded action type names are unique across agents.",
            check: async (ctx) => {
                if (!ctx.loadedActionTypes) return [];
                const byAction = new Map<string, string[]>();
                for (const [agent, actions] of Object.entries(
                    ctx.loadedActionTypes,
                )) {
                    for (const action of actions) {
                        const arr = byAction.get(action) ?? [];
                        arr.push(agent);
                        byAction.set(action, arr);
                    }
                }
                const dupes = [...byAction.entries()].filter(
                    ([, owners]) => owners.length > 1,
                );
                return dupes.map(([action, owners]) =>
                    warn(
                        ctx,
                        "actions.unique.acrossLoaded",
                        `Action '${action}' is provided by multiple agents: ${owners.join(", ")}.`,
                    ),
                );
            },
        },
        {
            id: "cache.compatible",
            description: "Schema hash is compatible with cache hash.",
            check: async (ctx) => {
                if (!ctx.cacheSchemaHash) return [];
                const currentHash = await computeSchemaHash(
                    ctx.files.schemaFiles,
                );
                if (!currentHash) return [];
                return currentHash === ctx.cacheSchemaHash
                    ? []
                    : [
                          info(
                              ctx,
                              "cache.compatible",
                              "Cache schema hash does not match the current schema; cache refresh recommended.",
                          ),
                      ];
            },
        },
    ];
}

async function readManifest(
    ctx: HealthContext,
): Promise<AgentManifest | undefined> {
    if (!ctx.files.manifestFile) return undefined;
    try {
        return JSON.parse(
            await fs.readFile(ctx.files.manifestFile, "utf8"),
        ) as AgentManifest;
    } catch {
        return undefined;
    }
}

function collectManifestRefs(manifest: AgentManifest): ManifestSchemaRef[] {
    const refs: ManifestSchemaRef[] = [];
    if (manifest.schema) {
        refs.push(manifest.schema);
    }
    for (const sub of Object.values(manifest.subActionManifests ?? {})) {
        if (sub.schema) {
            refs.push(sub.schema);
        }
    }
    return refs;
}

function allManifestSchemasInjected(manifest: AgentManifest): boolean {
    const refs = collectManifestRefs(manifest);
    return refs.length > 0 && refs.every((ref) => ref.injected === true);
}

async function computeSchemaHash(files: string[]): Promise<string | undefined> {
    return hashFileContents(files);
}

/**
 * Deterministic content hash over a set of files. Files are sorted by path so
 * the result is independent of discovery order; returns `undefined` for an
 * empty set so callers can distinguish "no files" from "empty files".
 */
export async function hashFileContents(
    files: string[],
): Promise<string | undefined> {
    if (files.length === 0) return undefined;
    const h = createHash("sha256");
    for (const file of files.slice().sort()) {
        h.update(await fs.readFile(file, "utf8"));
    }
    return h.digest("hex");
}

async function walkFiles(dir: string): Promise<string[]> {
    let entries: import("node:fs").Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
        }
        throw e;
    }
    const out: string[] = [];
    for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            out.push(...(await walkFiles(full)));
        } else if (ent.isFile()) {
            out.push(full);
        }
    }
    return out;
}

async function exists(file: string): Promise<boolean> {
    try {
        await fs.access(file);
        return true;
    } catch {
        return false;
    }
}

function err(
    ctx: HealthContext,
    ruleId: string,
    message: string,
    file?: string,
): HealthFinding {
    return {
        ruleId,
        severity: "error",
        agent: ctx.agent,
        evidence: {
            message,
            ...(file !== undefined ? { file } : {}),
        },
    };
}

function warn(
    ctx: HealthContext,
    ruleId: string,
    message: string,
): HealthFinding {
    return {
        ruleId,
        severity: "warning",
        agent: ctx.agent,
        evidence: { message },
    };
}

function info(
    ctx: HealthContext,
    ruleId: string,
    message: string,
): HealthFinding {
    return {
        ruleId,
        severity: "info",
        agent: ctx.agent,
        evidence: { message },
    };
}
