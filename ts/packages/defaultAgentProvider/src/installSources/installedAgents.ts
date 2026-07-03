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

// Map one config `agents` entry to an InstalledAgentRecord. A `path` entry
// becomes a path-resolved record (omits `module`); an entry with only a
// package `name` becomes a module-resolved record. `baseDir` is the directory
// relative `path` entries resolve against (the config dir).
function recordFromConfigEntry(
    name: string,
    entry: NpmAppAgentInfo,
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

// Seed records from a config's `agents` map (config.json or config.<name>.json).
// This is the bundled agent set: the agents that ship in the app and are always
// present. `source` is "builtin"; `path` entries resolve against the config
// (data) dir. Pure + synchronous: bundled entries are all local module/path
// refs (no feed / network), so building them is just record-shaping.
export function seedRecordsFromConfig(
    configName?: string,
): Record<string, InstalledAgentRecord> {
    const agents = getProviderConfig(configName).agents;
    const baseDir = path.dirname(getPackageFilePath("./data/config.json"));
    const records: Record<string, InstalledAgentRecord> = {};
    for (const [name, entry] of Object.entries(agents)) {
        records[name] = recordFromConfigEntry(name, entry, "builtin", baseDir);
    }
    return records;
}

// The names of the bundled agents for `configName` (default config when
// omitted). The bundled agents are their own static provider, so these names
// are reserved: an install can never shadow one, and a persisted install whose
// name collides is dropped at load (else the dispatcher throws when both the
// bundled and installed providers register the same name).
export function getBundledAgentNames(configName?: string): Set<string> {
    return new Set(Object.keys(getProviderConfig(configName).agents));
}

// Build the static bundled-agent AppAgentProvider (always present, immutable).
// These agents resolve against the app bundle and are never installed,
// uninstalled, or updated - they are simply the app's shipped agent set. This
// replaces the former "builtin" install source (design revert): bundled agents
// are no longer modeled as an install source.
export function createBundledAppAgentProvider(
    configName?: string,
): AppAgentProvider {
    // Bundled agents all resolve against the single app-bundle root (no
    // installDir), so there is exactly one group / provider.
    return createInstalledAppAgentProviders(seedRecordsFromConfig(configName), {
        appBundleRequirePath: getAppBundleRequirePath(),
    })[0];
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

/**
 * Build the installed-agent AppAgentProvider(s) over a set of records
 * (design §4.4). `module` records resolve against the provenance roots
 * (installDir first, then the app bundle); `path` records resolve from their
 * explicit absolute path (the requirePath is irrelevant for them). Records are
 * grouped by chosen root, and each group becomes its own
 * `createNpmAppAgentProvider` — so an agent set that spans roots is returned as
 * a LIST of single-root providers rather than combined behind a routing facade.
 * Callers that expect a single provider (bundled set, or a single-record
 * installed agent) always resolve to one root, so they can take `[0]`; the
 * indexing-service enumeration consumes the whole list. At least one (possibly
 * empty) provider is always returned, so the result is never empty.
 */
export function createInstalledAppAgentProviders(
    records: Record<string, InstalledAgentRecord>,
    roots: { installDir?: string; appBundleRequirePath: string },
): AppAgentProvider[] {
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
    return providers;
}

/**
 * Load the user-installed agent records from `agents.json` (design §4.2, §8).
 *
 * The bundled agents are a separate static provider (see
 * {@link createBundledAppAgentProvider}), so this returns ONLY the
 * user-installed agents - never the bundled set. agents.json holds only
 * installs. On first run it migrates any legacy externalAgentsConfig.json and
 * writes the (possibly empty) agents.json.
 *
 * Records whose name collides with a bundled agent are dropped: the bundled
 * provider owns that name, and registering it from two providers makes the
 * dispatcher throw "Conflicting app agents name".
 */
export function loadInstalledRecords(
    instanceDir: string,
): Record<string, InstalledAgentRecord> {
    const bundledNames = getBundledAgentNames();
    const existing = readAgentsJson(instanceDir);
    const installs: Record<string, InstalledAgentRecord> = {};
    if (existing !== undefined) {
        for (const [name, record] of Object.entries(existing.agents)) {
            // Drop any install whose name collides with a bundled agent (the
            // bundled provider owns it).
            if (!bundledNames.has(name)) {
                installs[name] = record;
            }
        }
    }
    // Migrate legacy path entries straight into installs.
    migrateLegacyExternalAgents(instanceDir, installs);
    // A migrated legacy entry could collide with a bundled name; drop it so the
    // bundled provider stays the sole owner.
    for (const name of Object.keys(installs)) {
        if (bundledNames.has(name)) {
            delete installs[name];
        }
    }
    fs.mkdirSync(instanceDir, { recursive: true });
    writeAgentsJson(instanceDir, { agents: installs });
    return installs;
}
