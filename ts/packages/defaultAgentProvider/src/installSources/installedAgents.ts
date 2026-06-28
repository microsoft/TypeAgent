// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import registerDebug from "debug";
import { AppAgentProvider } from "agent-dispatcher";
import { InstalledAgentRecord } from "./config.js";
import {
    createNpmAppAgentProvider,
    NpmAppAgentInfo,
} from "dispatcher-node-providers";
import { loadBundledCatalog, CatalogAgentInfo } from "./catalog.js";
import { getProviderConfig } from "../utils/config.js";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";

const debug = registerDebug("typeagent:dispatcher:installSource:installed");

// The single `agents.json` persisted under the instance dir (design §4.2).
// Replaces both the bundled `data/config.json` `agents` map at runtime and the
// legacy `externalAgentsConfig.json`.
export type AgentsJson = {
    agents: Record<string, InstalledAgentRecord>;
};

function agentsJsonPath(instanceDir: string): string {
    return path.join(instanceDir, "agents.json");
}

export function readAgentsJson(instanceDir: string): AgentsJson | undefined {
    const filePath = agentsJsonPath(instanceDir);
    if (!fs.existsSync(filePath)) {
        return undefined;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentsJson;
}

export function writeAgentsJson(instanceDir: string, data: AgentsJson): void {
    fs.writeFileSync(
        agentsJsonPath(instanceDir),
        JSON.stringify(data, null, 2),
    );
}

// The runtime root the bundled-catalog `module` records resolve against - the
// default-agent-provider package's own node_modules, exactly as today's
// defaultNpm provider does (design §4.1 "Module resolution roots").
export function getAppBundleRequirePath(): string {
    return getPackageFilePath("./package.json");
}

// ---------------------------------------------------------------------------
// Seeding (design §7): build InstalledAgentRecords from a catalog / agent map.
// ---------------------------------------------------------------------------

// Map one catalog / config `agents` entry to an InstalledAgentRecord. A `path`
// entry becomes a path-resolved record (omits `module`); an entry with only a
// package `name` becomes a module-resolved record. `baseDir` is the directory
// relative `path` entries resolve against (the catalog / config dir).
function recordFromCatalogEntry(
    name: string,
    entry: CatalogAgentInfo,
    source: string,
    baseDir: string,
): InstalledAgentRecord {
    const record: InstalledAgentRecord = {
        name,
        kind: "npm",
        source,
    };
    if (entry.path !== undefined) {
        record.path = path.resolve(baseDir, entry.path);
    } else {
        record.module = entry.name;
    }
    if (entry.execMode !== undefined) {
        record.loaderConfig = { execMode: entry.execMode };
    }
    return record;
}

// Seed records from the bundled catalog's `preinstall`-flagged entries
// (design §7). Pure + synchronous: bundled entries are all local module/path
// refs (no feed / network), so materializing them is just record-shaping and
// cannot partially fail. `source` is "builtin".
export function seedRecordsFromBundledCatalog(): Record<
    string,
    InstalledAgentRecord
> {
    const catalog = loadBundledCatalog();
    const baseDir = path.dirname(getPackageFilePath("./data/agents.json"));
    const records: Record<string, InstalledAgentRecord> = {};
    for (const [name, entry] of Object.entries(catalog.agents)) {
        if (entry.preinstall === true) {
            records[name] = recordFromCatalogEntry(
                name,
                entry,
                "builtin",
                baseDir,
            );
        }
    }
    return records;
}

// Seed records from a named config's `agents` map (config.<name>.json). Used
// for the named-config code path (e.g. "test", "all"), which selects a fixed
// agent set rather than going through install/agents.json. `source` is
// "builtin"; `path` entries resolve against the config (data) dir.
export function seedRecordsFromConfig(
    configName: string,
): Record<string, InstalledAgentRecord> {
    const agents = getProviderConfig(configName).agents;
    const baseDir = path.dirname(getPackageFilePath("./data/config.json"));
    const records: Record<string, InstalledAgentRecord> = {};
    for (const [name, entry] of Object.entries(agents)) {
        records[name] = recordFromCatalogEntry(name, entry, "builtin", baseDir);
    }
    return records;
}

// ---------------------------------------------------------------------------
// Migration shim (design §8, §12 Q14): legacy externalAgentsConfig.json.
// ---------------------------------------------------------------------------

// Migrate any legacy `externalAgentsConfig.json` into record form, mutating
// `records` in place. ONLY `path` entries are migrated (`source: "path"`);
// legacy npm/feed entries are dropped (the user re-installs them from the
// configured feed). The old file is renamed (not deleted) so the migration is
// one-time and auditable.
export function migrateLegacyExternalAgents(
    instanceDir: string,
    records: Record<string, InstalledAgentRecord>,
): void {
    const legacy = path.join(instanceDir, "externalAgentsConfig.json");
    if (!fs.existsSync(legacy)) {
        return;
    }
    try {
        const cfg = JSON.parse(fs.readFileSync(legacy, "utf8"));
        const agents = cfg?.agents;
        if (agents !== undefined) {
            for (const [name, info] of Object.entries(
                agents as Record<string, NpmAppAgentInfo>,
            )) {
                if (info.path === undefined) {
                    debug(
                        `migration: dropping legacy non-path agent '${name}' (re-install from feed)`,
                    );
                    continue;
                }
                if (records[name] !== undefined) {
                    // Never let a legacy path entry silently shadow a
                    // pre-installed builtin of the same name.
                    debug(
                        `migration: name collision - keeping existing record for '${name}', skipping legacy entry`,
                    );
                    continue;
                }
                const record: InstalledAgentRecord = {
                    name,
                    kind: "npm",
                    path: path.resolve(instanceDir, info.path),
                    source: "path",
                };
                if (info.execMode !== undefined) {
                    record.loaderConfig = { execMode: info.execMode };
                }
                records[name] = record;
                debug(`migration: migrated legacy path agent '${name}'`);
            }
        }
    } catch (e) {
        debug(
            `migration: failed to read legacy config: ${(e as Error).message}`,
        );
    }
    try {
        fs.renameSync(legacy, `${legacy}.migrated`);
    } catch (e) {
        debug(
            `migration: failed to rename legacy config: ${(e as Error).message}`,
        );
    }
}

// ---------------------------------------------------------------------------
// Provider building (design §4.4): one AppAgentProvider over agents.json.
// ---------------------------------------------------------------------------

// Resolve which runtime root a `module` record loads from (design §4.1
// "Module resolution roots"): probe the candidate roots in order (installDir
// for feed-installed modules, then the app bundle for bundled-catalog modules)
// and pick the first where the package's agent manifest resolves. Falls back
// to the last root so a genuinely missing module errors legibly at load.
function resolveModuleRoot(module: string, roots: string[]): string {
    for (const root of roots) {
        try {
            createRequire(root).resolve(`${module}/agent/manifest`);
            return root;
        } catch {
            // not resolvable from this root; try the next
        }
    }
    return roots[roots.length - 1];
}

function recordToNpmInfo(record: InstalledAgentRecord): NpmAppAgentInfo {
    // path records: the loader ignores `name` in its path branch (design §4.2),
    // so the dispatcher name is fine. module records: `name` is the package.
    const info: NpmAppAgentInfo = {
        name: record.module ?? record.name,
    };
    if (record.path !== undefined) {
        info.path = record.path;
    }
    const execMode = record.loaderConfig?.execMode;
    if (execMode !== undefined) {
        info.execMode = execMode as NonNullable<NpmAppAgentInfo["execMode"]>;
    }
    return info;
}

// Combine multiple AppAgentProviders into one facade routing each agent to its
// owning provider. Used because the installed-agent provider may span more than
// one `requirePath` root (feed installDir vs app bundle) while presenting a
// single provider to the dispatcher (design §4.4).
function combineAppAgentProviders(
    providers: AppAgentProvider[],
): AppAgentProvider {
    if (providers.length === 1) {
        return providers[0];
    }
    // Pre-compute name -> owning provider so routing is O(1), not a linear
    // scan per call.
    const owners = new Map<string, AppAgentProvider>();
    for (const provider of providers) {
        for (const name of provider.getAppAgentNames()) {
            owners.set(name, provider);
        }
    }
    function providerFor(name: string): AppAgentProvider {
        const provider = owners.get(name);
        if (provider === undefined) {
            throw new Error(`Invalid app agent: ${name}`);
        }
        return provider;
    }
    return {
        getAppAgentNames() {
            return providers.flatMap((p) => p.getAppAgentNames());
        },
        getAppAgentManifest(name) {
            return providerFor(name).getAppAgentManifest(name);
        },
        loadAppAgent(name) {
            return providerFor(name).loadAppAgent(name);
        },
        unloadAppAgent(name) {
            return providerFor(name).unloadAppAgent(name);
        },
        setTraceNamespaces(namespaces: string) {
            for (const provider of providers) {
                provider.setTraceNamespaces?.(namespaces);
            }
        },
    };
}

/**
 * Build the single installed-agent AppAgentProvider over a set of records
 * (design §4.4). `module` records resolve against the provenance roots
 * (installDir first, then the app bundle); `path` records resolve from their
 * explicit absolute path (the requirePath is irrelevant for them). Records are
 * grouped by chosen root so each group reuses one `createNpmAppAgentProvider`.
 */
export function createInstalledAppAgentProvider(
    records: Record<string, InstalledAgentRecord>,
    roots: { installDir?: string; appBundleRequirePath: string },
): AppAgentProvider {
    const appBundleRoot = roots.appBundleRequirePath;
    const moduleRoots =
        roots.installDir !== undefined
            ? [path.join(roots.installDir, "package.json"), appBundleRoot]
            : [appBundleRoot];

    // group: requirePath -> { [agentName]: NpmAppAgentInfo }
    const groups = new Map<string, Record<string, NpmAppAgentInfo>>();
    function groupFor(requirePath: string): Record<string, NpmAppAgentInfo> {
        let group = groups.get(requirePath);
        if (group === undefined) {
            group = {};
            groups.set(requirePath, group);
        }
        return group;
    }

    for (const [name, record] of Object.entries(records)) {
        const info = recordToNpmInfo(record);
        if (record.path !== undefined) {
            // path absolute -> requirePath base unused; co-locate with bundle.
            groupFor(appBundleRoot)[name] = info;
        } else {
            const root = resolveModuleRoot(
                record.module ?? record.name,
                moduleRoots,
            );
            groupFor(root)[name] = info;
        }
    }

    // Always build at least the (possibly empty) app-bundle group so the
    // provider is well-formed when there are no records.
    if (groups.size === 0) {
        groups.set(appBundleRoot, {});
    }

    const providers = Array.from(groups.entries()).map(
        ([requirePath, configs]) =>
            createNpmAppAgentProvider(configs, requirePath),
    );
    return combineAppAgentProviders(providers);
}

/**
 * Load the installed-agent records for a host (design §4.2, §7, §8).
 *
 * - Named config (e.g. "test") -> seed from config.<name>.json `agents`,
 *   in-memory only (those configs select a fixed agent set; no agents.json).
 * - Default config, no instance dir -> seed from the bundled catalog in-memory
 *   (the in-process / test case; equivalent to today's defaultNpm provider).
 * - Default config, instance dir with agents.json -> load it (steady state).
 * - Default config, instance dir, no agents.json -> first run: migrate any
 *   legacy externalAgentsConfig.json, pre-install the bundled builtins, and
 *   persist the result to agents.json.
 */
export function loadInstalledRecords(
    instanceDir: string | undefined,
    configName: string | undefined,
): Record<string, InstalledAgentRecord> {
    if (configName !== undefined) {
        return seedRecordsFromConfig(configName);
    }
    if (instanceDir === undefined) {
        return seedRecordsFromBundledCatalog();
    }
    const existing = readAgentsJson(instanceDir);
    if (existing !== undefined) {
        // Already initialized; only clean up a lingering legacy file (the
        // records are already persisted, so the migrated dict is discarded).
        migrateLegacyExternalAgents(instanceDir, {});
        return existing.agents;
    }
    // First run: pre-install builtins + migrate legacy path entries.
    const records = seedRecordsFromBundledCatalog();
    migrateLegacyExternalAgents(instanceDir, records);
    fs.mkdirSync(instanceDir, { recursive: true });
    writeAgentsJson(instanceDir, { agents: records });
    return records;
}
