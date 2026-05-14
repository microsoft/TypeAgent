// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Load an `ActionConfigProvider` from a sandbox directory. The optimize loop
// edits sandbox files between attempts; this provider gives the translator a
// view of those edits without touching the live agents.
//
// Sandbox layout:
//   sandbox/agents/<schemaName>/
//       manifest.json     # AppAgentManifest with schemaFile/grammarFile
//                         # pointing at files in this directory (e.g.
//                         # "./schema.ts" or "./schema.pas.json")
//       schema.ts         # optional — present when the agent has .ts source
//       schema.json       # optional sidecar config for .ts schemas
//       schema.pas.json   # optional — present when the agent has compiled .pas
//       grammar.ag.json   # optional
//
// `loadSandboxProvider` reads each schema's manifest, constructs an
// `AppAgentManifest` with inline `SchemaContent`/`GrammarContent` (not file
// paths — that would route through `getPackageFilePath` and miss the
// sandbox), feeds it to `convertToActionConfig`, and wraps the result in an
// `ActionConfigProvider`. PAS-only agents and `.ts`-source agents are both
// supported — the schema format is determined from the manifest's
// `schemaFile` path extension.

import * as fs from "node:fs";
import * as path from "node:path";

import type {
    AppAgentManifest,
    SchemaContent,
    SchemaFormat,
    GrammarContent,
} from "@typeagent/agent-sdk";
import {
    ActionConfig,
    convertToActionConfig,
} from "../../translation/actionConfig.js";
import type {
    ActionConfigProvider,
    ActionSchemaFile,
} from "../../translation/actionConfigProvider.js";
import { ActionSchemaFileCache } from "../../translation/actionSchemaFileCache.js";

const AGENTS_SUBDIR = "agents";
const MANIFEST_FILENAME = "manifest.json";

/**
 * Build an `ActionConfigProvider` from a sandbox directory. Each subdirectory
 * of `sandbox/agents/` is treated as one schema. Returns the provider plus
 * the list of schemas it loaded (useful for callers that need to enumerate
 * what the sandbox covers).
 */
export function loadSandboxProvider(sandboxDir: string): {
    provider: ActionConfigProvider;
    schemaNames: string[];
} {
    const agentsDir = path.join(sandboxDir, AGENTS_SUBDIR);
    if (!fs.existsSync(agentsDir)) {
        throw new Error(
            `loadSandboxProvider: ${agentsDir} does not exist. Build the sandbox first.`,
        );
    }

    // Build action configs per schema directory.
    const actionConfigs: Record<string, ActionConfig> = {};
    const schemaNames: string[] = [];
    const entries = fs
        .readdirSync(agentsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory());

    for (const entry of entries) {
        const schemaDir = path.join(agentsDir, entry.name);
        const manifestPath = path.join(schemaDir, MANIFEST_FILENAME);
        if (!fs.existsSync(manifestPath)) {
            // A directory without a manifest isn't a schema — skip silently
            // so callers can drop intermediate scratch dirs under agents/
            // without breaking provider loading.
            continue;
        }
        const manifest = readSandboxManifest(schemaDir, manifestPath);
        convertToActionConfig(entry.name, manifest, actionConfigs);
        schemaNames.push(entry.name);
    }

    // ActionSchemaFileCache caches by ActionConfig identity, so the same
    // config returned on subsequent lookups returns the same ActionSchemaFile
    // — important when this provider is wrapped (e.g. by
    // actionConfigOverride).
    const cache = new ActionSchemaFileCache();

    const provider: ActionConfigProvider = {
        tryGetActionConfig(schemaName: string): ActionConfig | undefined {
            return actionConfigs[schemaName];
        },
        getActionConfig(schemaName: string): ActionConfig {
            const c = actionConfigs[schemaName];
            if (!c) {
                throw new Error(
                    `Sandbox provider: unknown schema '${schemaName}'`,
                );
            }
            return c;
        },
        getActionConfigs(): ActionConfig[] {
            return Object.values(actionConfigs);
        },
        getActionSchemaFileForConfig(config: ActionConfig): ActionSchemaFile {
            return cache.getActionSchemaFile(config);
        },
    };
    return { provider, schemaNames };
}

/**
 * Read a sandbox manifest and inline the schema/grammar file contents so the
 * resulting `AppAgentManifest` doesn't route through `getPackageFilePath` at
 * load time. Paths in the manifest are resolved relative to the manifest
 * file's directory.
 */
function readSandboxManifest(
    schemaDir: string,
    manifestPath: string,
): AppAgentManifest {
    const raw = JSON.parse(
        fs.readFileSync(manifestPath, "utf-8"),
    ) as AppAgentManifest;
    if (!raw.schema) {
        // Sub-action-only manifests aren't supported in v1 sandbox loading.
        // No existing agent uses that shape at the top level today.
        return raw;
    }

    const schemaContent = inlineSchemaContent(
        schemaDir,
        raw.schema.schemaFile,
    );
    const grammarContent = inlineGrammarContent(
        schemaDir,
        raw.schema.grammarFile,
    );

    // Build a fresh manifest with inline content. Strip originalSchemaFile
    // and any path-string grammarFile so loaders don't try to resolve
    // package-relative paths against the sandbox — sandbox runs always
    // edit the artifact pointed at by schemaFile.
    const {
        originalSchemaFile: _origSchema,
        grammarFile: _rawGrammar,
        ...schemaWithoutResolvables
    } = raw.schema;
    void _origSchema;
    void _rawGrammar;
    const sandboxSchema = {
        ...schemaWithoutResolvables,
        schemaFile: schemaContent,
        ...(grammarContent !== undefined && { grammarFile: grammarContent }),
    };
    // grammarFile is omitted entirely (rather than set to undefined) when
    // none was supplied — exactOptionalPropertyTypes wants the property gone.
    const sandboxManifest: AppAgentManifest = {
        ...raw,
        schema: sandboxSchema,
    };
    return sandboxManifest;
}

function inlineSchemaContent(
    schemaDir: string,
    schemaFile: string | SchemaContent | undefined,
): SchemaContent {
    if (schemaFile === undefined) {
        throw new Error(
            `Sandbox manifest at ${schemaDir} has no schema.schemaFile`,
        );
    }
    if (typeof schemaFile !== "string") {
        // Already inline — pass through.
        return schemaFile;
    }
    const filePath = path.resolve(schemaDir, schemaFile);
    if (!fs.existsSync(filePath)) {
        throw new Error(
            `Sandbox manifest at ${schemaDir} references missing schema file: ${schemaFile}`,
        );
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const format: SchemaFormat = filePath.endsWith(".pas.json") ? "pas" : "ts";
    // For .ts schemas, look for a sidecar config file (same basename, .json).
    let config: string | undefined;
    if (format === "ts") {
        const parsed = path.parse(filePath);
        // For .ts schemas, the sidecar is <basename>.json. For .pas.json
        // we don't read a sidecar (the config is embedded).
        const sidecar = path.join(parsed.dir, parsed.name + ".json");
        if (fs.existsSync(sidecar)) {
            config = fs.readFileSync(sidecar, "utf-8");
        }
    }
    return { format, content, config };
}

function inlineGrammarContent(
    schemaDir: string,
    grammarFile: string | GrammarContent | undefined,
): GrammarContent | undefined {
    if (grammarFile === undefined) return undefined;
    if (typeof grammarFile !== "string") {
        return grammarFile;
    }
    const filePath = path.resolve(schemaDir, grammarFile);
    if (!fs.existsSync(filePath)) {
        // Grammar is optional — skip silently if the file isn't there.
        return undefined;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    if (!grammarFile.endsWith(".ag.json")) {
        throw new Error(
            `Sandbox grammar file must be .ag.json: ${grammarFile}`,
        );
    }
    return { format: "ag", content };
}
