// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Build `sandbox/agents/<schemaName>/` from live source. For each schema
// the optimize loop wants to cover, the builder copies the schema file
// (`.ts` or `.pas.json`), the sidecar config (for `.ts` schemas), the
// compiled grammar, and writes a synthetic manifest with paths pointing
// at the sandbox-local files.
//
// The synthetic manifest is constructed from `ActionConfig` fields rather
// than reading the original manifest file — `ActionConfig` already
// carries everything `convertToActionConfig` needs. The top-level
// `description` reuses the schema-level description (the dispatcher's
// translator only needs the schema-level field; sandbox runs never
// surface the top-level description anywhere user-facing).
//
// After buildSandbox runs, the caller calls `snapshotSandboxOriginal` to
// freeze the pristine state for per-attempt reverts.

import * as fs from "node:fs";
import * as path from "node:path";

import type { AppAgentManifest, SchemaManifest } from "@typeagent/agent-sdk";
import {
    getGrammarContent,
    getSchemaContent,
} from "../../translation/actionConfig.js";
import type { ActionConfigProvider } from "../../translation/actionConfigProvider.js";
import { ensureDir } from "./util.js";

const AGENTS_SUBDIR = "agents";

export interface BuildSandboxOpts {
    /** The sandbox root directory. The builder creates
     *  `<sandboxDir>/agents/<schemaName>/` for each schema. */
    sandboxDir: string;
    /** The live ActionConfigProvider (typically `systemContext.agents`). */
    sourceProvider: ActionConfigProvider;
    /** Schemas to materialize. Schemas not in `sourceProvider` are skipped
     *  with a `not-found` reason in the result. */
    schemaNames: string[];
}

export interface BuildSandboxResult {
    /** Schema names that were materialized successfully. */
    schemaNames: string[];
    /** Schemas the builder couldn't materialize, with a reason. Used by
     *  the optimize run to populate `corpusCoverage.skippedAgents`. */
    skipped: { schemaName: string; reason: string }[];
}

/**
 * Materialize a sandbox tree on disk. Idempotent: re-running overwrites
 * existing schema directories.
 */
export function buildSandbox(opts: BuildSandboxOpts): BuildSandboxResult {
    const agentsDir = path.join(opts.sandboxDir, AGENTS_SUBDIR);
    ensureDir(agentsDir);

    const materialized: string[] = [];
    const skipped: { schemaName: string; reason: string }[] = [];

    for (const schemaName of opts.schemaNames) {
        const config = opts.sourceProvider.tryGetActionConfig(schemaName);
        if (!config) {
            skipped.push({ schemaName, reason: "not-found" });
            continue;
        }
        try {
            const schemaContent = getSchemaContent(config);
            const grammarContent = getGrammarContent(config);

            const schemaDir = path.join(agentsDir, schemaName);
            ensureDir(schemaDir);

            // Schema artifact.
            const schemaBasename =
                schemaContent.format === "pas"
                    ? "schema.pas.json"
                    : "schema.ts";
            fs.writeFileSync(
                path.join(schemaDir, schemaBasename),
                schemaContent.content,
            );

            // Sidecar config (for `.ts` schemas only).
            if (
                schemaContent.format === "ts" &&
                schemaContent.config !== undefined
            ) {
                fs.writeFileSync(
                    path.join(schemaDir, "schema.json"),
                    schemaContent.config,
                );
            }

            // Grammar (optional).
            if (grammarContent !== undefined) {
                fs.writeFileSync(
                    path.join(schemaDir, "grammar.ag.json"),
                    grammarContent.content,
                );
            }

            // Synthetic manifest pointing at the sandbox-local files.
            const sandboxManifest = buildSandboxManifest(
                config,
                schemaBasename,
                grammarContent !== undefined,
            );
            fs.writeFileSync(
                path.join(schemaDir, "manifest.json"),
                JSON.stringify(sandboxManifest, undefined, 2),
            );

            materialized.push(schemaName);
        } catch (err) {
            skipped.push({
                schemaName,
                reason: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return { schemaNames: materialized, skipped };
}

function buildSandboxManifest(
    config: {
        emojiChar: string;
        description: string;
        schemaType: SchemaManifest["schemaType"];
        injected?: boolean;
        cached?: boolean;
        streamingActions?: string[];
        transient: boolean;
        schemaDefaultEnabled: boolean;
        actionDefaultEnabled: boolean;
        errorReasoning: boolean;
    },
    schemaBasename: string,
    hasGrammar: boolean,
): AppAgentManifest {
    const schema: SchemaManifest = {
        description: config.description,
        schemaType: config.schemaType,
        schemaFile: `./${schemaBasename}`,
        ...(hasGrammar && { grammarFile: "./grammar.ag.json" }),
        ...(config.injected && { injected: config.injected }),
        ...(config.cached !== undefined && { cached: config.cached }),
        ...(config.streamingActions &&
            config.streamingActions.length > 0 && {
                streamingActions: config.streamingActions,
            }),
    };
    // Top-level AppAgentManifest fields. We reuse the schema-level
    // description for the agent-level description; sandbox runs don't
    // surface the agent description anywhere translator-visible.
    return {
        emojiChar: config.emojiChar,
        description: config.description,
        schema,
        ...(config.transient && { transient: true }),
        ...(config.schemaDefaultEnabled === false && {
            schemaDefaultEnabled: false,
        }),
        ...(config.actionDefaultEnabled === false && {
            actionDefaultEnabled: false,
        }),
        ...(config.errorReasoning && { errorReasoning: true }),
    };
}
