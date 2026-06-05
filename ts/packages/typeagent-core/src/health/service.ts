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

export interface FileHealthServiceOptions {
    repoRoot: string;
    loadedActionTypes?: Record<string, string[]>;
    cacheSchemaHash?: string;
}

interface ManifestSchemaRef {
    originalSchemaFile?: string;
    schemaFile?: string;
    grammarFile?: string;
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
        const files = await discoverAgentFiles(this.opts.repoRoot, agent);
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

export async function discoverAgentFiles(
    repoRoot: string,
    agent: string,
): Promise<AgentFileRefs> {
    const packageDir = path.join(repoRoot, "packages", "agents", agent);
    const srcDir = path.join(packageDir, "src");
    const all = await walkFiles(srcDir);

    const manifestFile = all.find((f) => /manifest\.json$/i.test(f));

    const schemaFiles = all.filter(
        (f) => /schema/i.test(path.basename(f)) && /\.(ts|json)$/i.test(f),
    );
    const grammarFiles = all.filter((f) => /\.agr$/i.test(f) || /\.ag\.json$/i.test(f));
    const handlerFiles = all.filter((f) => /actionhandler/i.test(path.basename(f)));

    return {
        packageDir,
        srcDir,
        ...(manifestFile !== undefined ? { manifestFile } : {}),
        schemaFiles,
        grammarFiles,
        handlerFiles,
    };
}

function createRules(): HealthRule[] {
    return [
        {
            id: "manifest.parses",
            description: "Manifest exists and parses as JSON.",
            check: async (ctx) => {
                if (!ctx.files.manifestFile) {
                    return [err(ctx, "manifest.parses", "Manifest file was not found under src/")];
                }
                try {
                    JSON.parse(await fs.readFile(ctx.files.manifestFile, "utf8"));
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
            description: "Manifest name (if present) matches package directory name.",
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
                    for (const candidate of [ref.originalSchemaFile, ref.schemaFile, ref.grammarFile]) {
                        if (!candidate) continue;
                        const abs = path.resolve(path.dirname(ctx.files.manifestFile!), candidate);
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
                        findings.push(err(ctx, "schema.parses", "Schema file is empty.", file));
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
            description: "At least one grammar file exists when schema files exist.",
            check: async (ctx) => {
                if (ctx.files.schemaFiles.length === 0 || ctx.files.grammarFiles.length > 0) {
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
            description: "Grammar files are parseable (JSON) or non-empty (AGR).",
            check: async (ctx) => {
                const findings: HealthFinding[] = [];
                for (const file of ctx.files.grammarFiles) {
                    const text = await fs.readFile(file, "utf8");
                    if (text.trim().length === 0) {
                        findings.push(err(ctx, "grammar.parses", "Grammar file is empty.", file));
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
            description: "Grammar targets should map to known actions (heuristic MVP check).",
            check: async (ctx) => {
                if (ctx.files.grammarFiles.length === 0 || ctx.files.schemaFiles.length === 0) {
                    return [];
                }
                // MVP heuristic: if we have both files, we assume target mapping is
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
                    if (/export\s+(async\s+)?function\s+instantiate\s*\(/.test(text)) {
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
            id: "provider.registers",
            description: "defaultAgentProvider config includes the agent.",
            check: async (ctx) => {
                const cfg = path.join(
                    ctx.repoRoot,
                    "packages",
                    "defaultAgentProvider",
                    "data",
                    "config.json",
                );
                if (!(await exists(cfg))) {
                    return [
                        err(
                            ctx,
                            "provider.registers",
                            "defaultAgentProvider config.json was not found.",
                            cfg,
                        ),
                    ];
                }
                try {
                    const parsed = JSON.parse(await fs.readFile(cfg, "utf8"));
                    const agents = (parsed?.agents ?? {}) as Record<string, unknown>;
                    return agents[ctx.agent] !== undefined
                        ? []
                        : [
                              err(
                                  ctx,
                                  "provider.registers",
                                  `Agent '${ctx.agent}' is not registered in defaultAgentProvider config.json.`,
                                  cfg,
                              ),
                          ];
                } catch (e) {
                    return [
                        err(
                            ctx,
                            "provider.registers",
                            `config.json parse failed: ${(e as Error).message}`,
                            cfg,
                        ),
                    ];
                }
            },
        },
        {
            id: "actions.unique.acrossLoaded",
            description: "Loaded action type names are unique across agents.",
            check: async (ctx) => {
                if (!ctx.loadedActionTypes) return [];
                const byAction = new Map<string, string[]>();
                for (const [agent, actions] of Object.entries(ctx.loadedActionTypes)) {
                    for (const action of actions) {
                        const arr = byAction.get(action) ?? [];
                        arr.push(agent);
                        byAction.set(action, arr);
                    }
                }
                const dupes = [...byAction.entries()].filter(([, owners]) => owners.length > 1);
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
                const currentHash = await computeSchemaHash(ctx.files.schemaFiles);
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

async function readManifest(ctx: HealthContext): Promise<AgentManifest | undefined> {
    if (!ctx.files.manifestFile) return undefined;
    try {
        return JSON.parse(await fs.readFile(ctx.files.manifestFile, "utf8")) as AgentManifest;
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

async function computeSchemaHash(files: string[]): Promise<string | undefined> {
    return hashFileContents(files);
}

/**
 * Deterministic content hash over a set of files. Files are sorted by path so
 * the result is independent of discovery order; returns `undefined` for an
 * empty set so callers can distinguish "no files" from "empty files".
 */
export async function hashFileContents(files: string[]): Promise<string | undefined> {
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
