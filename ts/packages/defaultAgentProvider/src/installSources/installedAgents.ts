// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { AppAgentProvider } from "agent-dispatcher";
import { InstalledAgentRecord, AGENT_INSTALL_ROOTS_SUBDIR } from "./config.js";
import {
    createNpmAppAgentProvider,
    NpmAppAgentInfo,
} from "dispatcher-node-providers";

import { getProviderConfig } from "../utils/config.js";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";

// The single `agents.json` persisted under the instance dir (design §4.2): the
// store of USER-INSTALLED agent records only. The bundled agent set is defined
// separately by the `data/config.json` `agents` map at runtime (see
// {@link seedRecordsFromConfig} / {@link createBundledAppAgentProvider}) - it
// is not stored here.
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
function getAppBundleRequirePath(): string {
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
    // Bundled agents ship in the app and all resolve against the single
    // app-bundle root, so they are one provider at that root - no installDir
    // and no per-record root resolution.
    const configs: Record<string, NpmAppAgentInfo> = {};
    for (const [name, record] of Object.entries(
        seedRecordsFromConfig(configName),
    )) {
        configs[name] = recordToNpmInfo(record);
    }
    return createNpmAppAgentProvider(configs, getAppBundleRequirePath());
}

// ---------------------------------------------------------------------------
// Provider building (design §4.4): one single-agent provider per install.
// ---------------------------------------------------------------------------

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
 * The absolute require-root a `module` install record resolves its package
 * against (design §5.5). A record carrying a per-agent `installRoot` resolves
 * from its OWN version-scoped root
 * (`installDir/<AGENT_INSTALL_ROOTS_SUBDIR>/<installRoot>`); a legacy record
 * without one falls back to the shared `installDir` (back-compat with
 * pre-version-scoping `agents.json`). `path` records are unaffected (they carry
 * an absolute path, so this require-root is a harmless base).
 */
export function recordRequirePath(
    record: InstalledAgentRecord,
    installDir: string,
): string {
    const root =
        record.installRoot !== undefined
            ? path.join(
                  installDir,
                  AGENT_INSTALL_ROOTS_SUBDIR,
                  record.installRoot,
              )
            : installDir;
    return path.join(root, "package.json");
}

/**
 * Build the AppAgentProvider for a SINGLE installed agent record (design §4.4).
 * Installed agents are feed installs materialized under `installDir`, so a
 * `module` record resolves from its own per-agent version-scoped root
 * (`record.installRoot`) — or, for a legacy record without one, from the shared
 * `installDir`; a `path` record resolves from its own absolute path (the
 * requirePath is irrelevant, so the derived root is a harmless base). This is
 * the runtime unit the dynamic source vends - one single-agent provider per
 * installed agent. (Bundled agents are the separate, app-bundle-rooted
 * {@link createBundledAppAgentProvider}.)
 */
export function createInstalledAppAgentProvider(
    name: string,
    record: InstalledAgentRecord,
    installDir: string,
): AppAgentProvider {
    return createNpmAppAgentProvider(
        { [name]: recordToNpmInfo(record) },
        recordRequirePath(record, installDir),
    );
}

/**
 * Build one single-agent provider per record (design §4.4). Used for static
 * enumeration (the indexing-service registry), which consumes the list; the
 * runtime source builds each agent's provider individually via
 * {@link createInstalledAppAgentProvider}. Returns [] for no records.
 */
export function createInstalledAppAgentProviders(
    records: Record<string, InstalledAgentRecord>,
    installDir: string,
): AppAgentProvider[] {
    return Object.entries(records).map(([name, record]) =>
        createInstalledAppAgentProvider(name, record, installDir),
    );
}

/**
 * Load the user-installed agent records from `agents.json` (design §4.2).
 *
 * The bundled agents are a separate static provider (see
 * {@link createBundledAppAgentProvider}), so this returns ONLY the
 * user-installed agents - never the bundled set. agents.json holds only
 * installs; on first run it writes the (possibly empty) agents.json.
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
    fs.mkdirSync(instanceDir, { recursive: true });
    writeAgentsJson(instanceDir, { agents: installs });
    return installs;
}
